import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';

import { isProUser } from './revenuecat';
import { supabase } from './supabase';

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB (photos run larger)
const FREE_LIMIT = 3;

export type FileType = 'pdf' | 'image';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;
const UPLOAD_TIMEOUT_MS = 30000;

// Sentinel so an upload that hangs past the timeout never blocks indefinitely.
const UPLOAD_TIMED_OUT = Symbol('upload-timed-out');

export type UploadResult =
  | { worksheetId: string; storagePath: string }
  | { error: string };

export type FillResult = { outputPath: string } | { error: string };

export type UsageInfo = {
  used: number;
  limit: number;
  canUse: boolean;
  isPro: boolean;
};

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read a local PDF or image, validate size, upload to Storage, and create the
 * worksheet row (status `pending`). Returns ids or a surfaced error — never throws.
 */
export async function uploadWorksheet(
  uri: string,
  userId: string,
  fileType: FileType
): Promise<UploadResult> {
  try {
    const isPdf = fileType === 'pdf';
    const ext = isPdf ? 'pdf' : 'jpg';
    const mimeType = isPdf ? 'application/pdf' : 'image/jpeg';
    const maxBytes = isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;

    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      return { error: 'That file could not be found. Please pick it again.' };
    }
    if (typeof info.size === 'number' && info.size > maxBytes) {
      return {
        error: `That file is over ${isPdf ? '10MB' : '20MB'}. Please choose a smaller one.`,
      };
    }

    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = decode(base64);

    const storagePath = `uploads/${userId}/${Date.now()}.${ext}`;
    // 1.1 — never let a stalled connection hang the upload forever.
    const raced = await Promise.race([
      supabase.storage.from('worksheets').upload(storagePath, bytes, { contentType: mimeType }),
      sleep(UPLOAD_TIMEOUT_MS).then(() => UPLOAD_TIMED_OUT),
    ]);
    if (typeof raced === 'symbol') {
      return { error: 'Upload timed out. Check your connection and try again.' };
    }
    if (raced.error) {
      return { error: raced.error.message };
    }

    const { data, error: insertError } = await supabase
      .from('worksheets')
      .insert({ user_id: userId, storage_path: storagePath, status: 'pending' })
      .select('id')
      .single();
    if (insertError || !data) {
      return { error: insertError?.message ?? 'Could not create the worksheet.' };
    }

    return { worksheetId: data.id as string, storagePath };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Upload failed.' };
  }
}

/**
 * Invoke the edge function, then poll the worksheet row until it settles
 * (not `pending`/`processing`) or 30s elapses.
 */
export async function fillWorksheet(
  worksheetId: string,
  storagePath: string,
  style: string,
  difficulty: string,
  subject: string
): Promise<FillResult> {
  try {
    // 3.2 — session must be valid (and not expired) before we proceed; the edge
    // function requires the JWT, and the user can't proceed without re-auth.
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError || !session) {
      return { error: 'Your session expired. Please sign in again.' };
    }

    // Forward the user's access token so the edge function can verify identity
    // + ownership (it rejects calls without a valid JWT).
    const { data: invokeData, error: invokeError } = await supabase.functions.invoke(
      'fill-worksheet',
      {
        body: { worksheetId, storagePath, style, difficulty, subject },
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
      }
    );

    // Fast path: the function ran synchronously and told us the result.
    if (!invokeError && invokeData) {
      if (invokeData.success && invokeData.outputPath) {
        return { outputPath: invokeData.outputPath as string };
      }
      if (invokeData.success === false) {
        return { error: invokeData.error ?? 'Worksheet processing failed.' };
      }
    }

    // Fallback: poll the row in case the function is still finishing.
    // 1.2 — a network error during polling does NOT retry forever: we keep
    // looping only until the 30s ceiling, then return a clear lost-connection
    // message instead of a raw error or a false "timed out".
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let sawNetworkError = false;
    while (Date.now() < deadline) {
      try {
        const { data, error } = await supabase
          .from('worksheets')
          .select('status, output_path, error')
          .eq('id', worksheetId)
          .single();
        if (error) {
          sawNetworkError = true; // treat read failure as a transient blip
        } else {
          sawNetworkError = false;
          if (data.status === 'complete' && data.output_path) {
            return { outputPath: data.output_path as string };
          }
          if (data.status === 'error') {
            return { error: (data.error as string) ?? 'Worksheet processing failed.' };
          }
        }
      } catch {
        sawNetworkError = true;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    // Ceiling reached.
    if (sawNetworkError) {
      return {
        error: 'Lost connection while processing. Check History to see if it finished.',
      };
    }
    if (invokeError) {
      return { error: invokeError.message };
    }
    return { error: 'Timed out waiting for your worksheet. Please try again.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not fill the worksheet.' };
  }
}

/**
 * Read this month's usage. Free tier = 3 worksheets / month. Fails open on a
 * read error (lets the user try) but never throws.
 */
export async function checkUsage(userId: string): Promise<UsageInfo> {
  // Pro is checked client-side via RevenueCat (no isPro DB column). Pro users
  // are unlimited regardless of the monthly counter.
  // 4.1 — fail OPEN if RevenueCat is unreachable: don't block a paying user on a
  // transient error; fall through to the DB free-tier check (still usable).
  try {
    const pro = await isProUser();
    if (pro) {
      return { used: 0, limit: Infinity, canUse: true, isPro: true };
    }
  } catch (e) {
    console.error('RevenueCat check failed, failing open to DB free-tier check:', e);
  }
  try {
    const { data, error } = await supabase
      .from('usage')
      .select('worksheets_used')
      .eq('user_id', userId)
      .eq('month', currentMonth())
      .maybeSingle();
    const used = !error && data ? (data.worksheets_used as number) : 0;
    return { used, limit: FREE_LIMIT, canUse: used < FREE_LIMIT, isPro: false };
  } catch {
    return { used: 0, limit: FREE_LIMIT, canUse: true, isPro: false };
  }
}

// NOTE: usage is now incremented SERVER-SIDE by the fill-worksheet edge function
// (service role). Clients can no longer write the `usage` table (RLS write
// policies were removed), so there is intentionally no client incrementUsage().
