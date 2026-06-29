import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';

import { isProUser } from './revenuecat';
import { supabase } from './supabase';

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const FREE_LIMIT = 3;
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

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
 * Read a local PDF, validate size, upload to Storage, and create the worksheet
 * row (status `pending`). Returns ids or a surfaced error — never throws.
 */
export async function uploadWorksheet(
  uri: string,
  userId: string
): Promise<UploadResult> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      return { error: 'That file could not be found. Please pick it again.' };
    }
    if (typeof info.size === 'number' && info.size > MAX_BYTES) {
      return { error: 'That PDF is over 10MB. Please choose a smaller file.' };
    }

    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = decode(base64);

    const storagePath = `uploads/${userId}/${Date.now()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('worksheets')
      .upload(storagePath, bytes, { contentType: 'application/pdf' });
    if (uploadError) {
      return { error: uploadError.message };
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
    const { data: invokeData, error: invokeError } = await supabase.functions.invoke(
      'fill-worksheet',
      { body: { worksheetId, storagePath, style, difficulty, subject } }
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
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const { data, error } = await supabase
        .from('worksheets')
        .select('status, output_path, error')
        .eq('id', worksheetId)
        .single();
      if (error) {
        return { error: error.message };
      }
      if (data.status === 'complete' && data.output_path) {
        return { outputPath: data.output_path as string };
      }
      if (data.status === 'error') {
        return { error: (data.error as string) ?? 'Worksheet processing failed.' };
      }
      await sleep(POLL_INTERVAL_MS);
    }

    // If invoke itself errored and we never settled, surface that.
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
  const pro = await isProUser();
  if (pro) {
    return { used: 0, limit: Infinity, canUse: true, isPro: true };
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

/**
 * Increment this month's usage. Best-effort: swallows errors (returns void).
 */
export async function incrementUsage(userId: string): Promise<void> {
  try {
    const month = currentMonth();
    const { data } = await supabase
      .from('usage')
      .select('worksheets_used')
      .eq('user_id', userId)
      .eq('month', month)
      .maybeSingle();
    const next = (data?.worksheets_used ?? 0) + 1;
    await supabase
      .from('usage')
      .upsert(
        { user_id: userId, month, worksheets_used: next },
        { onConflict: 'user_id,month' }
      );
  } catch {
    // Non-fatal — usage tracking is best-effort for MVP.
  }
}
