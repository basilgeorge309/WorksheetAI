import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';

import { sendLocalNotification } from './notifications';
import { getUserTier, UserTier } from './revenuecat';
import { supabase } from './supabase';

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB (photos run larger)
// Free = worksheet COUNT cap; Pro/Max = monthly dollar cap (cents). Mirrors the
// server-side TIER_LIMITS in the fill-worksheet edge function.
const TIER_CAPS: Record<UserTier, number> = { free: 3, pro: 1000, max: 5000 };

export type FileType = 'pdf' | 'image';
const POLL_INTERVAL_MS = 2000;
// Image generation (solve + gpt-image-2 edit) can take 1-2+ minutes, so poll well
// past the old 30s ceiling before giving up.
const POLL_TIMEOUT_MS = 180000;
const UPLOAD_TIMEOUT_MS = 30000;

// Sentinel so an upload that hangs past the timeout never blocks indefinitely.
const UPLOAD_TIMED_OUT = Symbol('upload-timed-out');

export type UploadResult =
  | { worksheetId: string; storagePath: string }
  | { error: string };

export type FillResult = { outputPath: string } | { error: string };

export type UsageInfo = {
  tier: UserTier;
  capType: 'count' | 'cost'; // 'count' = worksheets (free); 'cost' = cents (pro/max)
  used: number; // free: worksheets used; pro/max: cents spent this month
  limit: number; // free: 3; pro: 1000; max: 5000
  canUse: boolean;
  isPro: boolean; // tier !== 'free' (back-compat for existing callers)
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

    // PDFs: rasterize page 1 to a PNG ON-DEVICE (native PDFKit/PdfRenderer) and store
    // it, so the edge function never has to run mupdf (which blows the 2s CPU limit).
    // Best-effort: on any failure raster_path stays null and the edge function will ask
    // the user for a photo. (The native module is unavailable in Expo Go.)
    let rasterPath: string | null = null;
    if (isPdf) {
      try {
        const PdfThumbnail = (await import('react-native-pdf-thumbnail')).default;
        const { uri: pngUri } = await PdfThumbnail.generate(uri, 0);
        const pngBase64 = await FileSystem.readAsStringAsync(pngUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const pngBytes = decode(pngBase64);
        rasterPath = `uploads/${userId}/${Date.now()}_page.png`;
        const { error: rasterErr } = await supabase.storage
          .from('worksheets')
          .upload(rasterPath, pngBytes, { contentType: 'image/png' });
        if (rasterErr) rasterPath = null;
      } catch (e) {
        console.warn('Client PDF rasterize failed:', e instanceof Error ? e.message : e);
        rasterPath = null;
      }
    }

    const { data, error: insertError } = await supabase
      .from('worksheets')
      .insert({ user_id: userId, storage_path: storagePath, status: 'pending', raster_path: rasterPath })
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

const BG_POLL_INTERVAL_MS = 3000;
const BG_POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min — well past the ~2min fill time.

/**
 * Fire-and-forget fill: kick off the edge function (never awaited) and watch the
 * worksheet row in the background, firing a local notification when it settles.
 *
 * This is intentionally detached from any component lifecycle — the caller (Home)
 * navigates away immediately, so we use a plain `setTimeout` chain rather than a
 * React effect. Note: iOS suspends JS timers while the app is backgrounded, so the
 * notification reliably fires when the app is foregrounded or on resume; the
 * History banner + auto-refresh cover the reopen case.
 */
export function pollInBackground(
  worksheetId: string,
  storagePath: string,
  style: string,
  difficulty: string,
  subject: string
): void {
  void (async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      await sendLocalNotification(
        'Worksheet failed',
        'Your session expired. Sign in and try again.'
      );
      return;
    }

    // Kick off the edge function but never await it — we learn the outcome by
    // watching the DB row, so a slow or aborted invoke can't hang the poll.
    supabase.functions
      .invoke('fill-worksheet', {
        body: { worksheetId, storagePath, style, difficulty, subject },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      .catch(() => {
        // Swallowed — the poll loop below reports the real outcome from the row.
      });

    const deadline = Date.now() + BG_POLL_TIMEOUT_MS;

    const tick = async () => {
      if (Date.now() >= deadline) {
        await sendLocalNotification(
          'Still working…',
          'Your worksheet is taking longer than usual. Check History soon.'
        );
        return;
      }
      try {
        const { data, error } = await supabase
          .from('worksheets')
          .select('status, output_path')
          .eq('id', worksheetId)
          .single();
        if (!error && data) {
          if (data.status === 'complete' && data.output_path) {
            await sendLocalNotification(
              'Worksheet ready! 📝',
              'Tap to view your filled worksheet.',
              { worksheetId, outputPath: data.output_path }
            );
            return;
          }
          if (data.status === 'error') {
            await sendLocalNotification(
              'Worksheet failed',
              'Something went wrong. Open History to retry.'
            );
            return;
          }
        }
      } catch {
        // Transient read blip — keep polling until the deadline.
      }
      setTimeout(tick, BG_POLL_INTERVAL_MS);
    };

    setTimeout(tick, BG_POLL_INTERVAL_MS);
  })();
}

/**
 * Read this month's usage for the user's tier. Free = worksheet COUNT cap (3);
 * Pro/Max = monthly dollar (cost_cents) cap. This drives the UI + the pre-upload
 * gate; the edge function independently re-verifies tier + enforces server-side.
 * Fails open (lets the user try) and never throws.
 */
export async function checkUsage(userId: string): Promise<UsageInfo> {
  // Tier is read from RevenueCat; on any error treat as 'free' (safe — the server
  // enforces the real cap regardless).
  let tier: UserTier = 'free';
  try {
    tier = await getUserTier();
  } catch (e) {
    console.error('RevenueCat tier check failed, treating as free:', e);
  }
  const capType: 'count' | 'cost' = tier === 'free' ? 'count' : 'cost';
  const limit = TIER_CAPS[tier];
  const isPro = tier !== 'free';
  try {
    const { data, error } = await supabase
      .from('usage')
      .select('worksheets_used, cost_cents')
      .eq('user_id', userId)
      .eq('month', currentMonth())
      .maybeSingle();
    const row = !error && data ? data : null;
    const used =
      capType === 'count'
        ? ((row?.worksheets_used as number) ?? 0)
        : ((row?.cost_cents as number) ?? 0);
    return { tier, capType, used, limit, canUse: used < limit, isPro };
  } catch {
    return { tier, capType, used: 0, limit, canUse: true, isPro };
  }
}

// NOTE: usage is now incremented SERVER-SIDE by the fill-worksheet edge function
// (service role). Clients can no longer write the `usage` table (RLS write
// policies were removed), so there is intentionally no client incrementUsage().
