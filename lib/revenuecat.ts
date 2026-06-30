import { Platform } from 'react-native';

// react-native-purchases is a NATIVE module: it works in dev/standalone builds
// but NOT in Expo Go. We lazy-import it so this file never touches native code
// at module load, and every call falls back gracefully.
let Purchases: any = null;

const loadPurchases = async (): Promise<any | null> => {
  if (!Purchases) {
    try {
      Purchases = (await import('react-native-purchases')).default;
    } catch {
      return null;
    }
  }
  return Purchases;
};

export const initRevenueCat = async (): Promise<void> => {
  const P = await loadPurchases();
  if (!P) return;
  const apiKey =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS
      : process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID;
  if (!apiKey) return;
  try {
    await P.configure({ apiKey });
  } catch {
    // Non-fatal — pro features simply stay locked if configure fails.
  }
};

// 4.2 — getCustomerInfo() queries RevenueCat (which syncs with the App/Play
// Store), so subscriptions cancelled OUTSIDE the app (in iOS/Android settings)
// are reflected here on the next check — it's not a stale local flag. isProUser()
// always calls it fresh, so an external cancellation is detected next time usage
// is checked (e.g. on Home focus).
export const getCustomerInfo = async (): Promise<any | null> => {
  const P = await loadPurchases();
  if (!P) return null;
  try {
    return await P.getCustomerInfo();
  } catch {
    return null;
  }
};

export const isProUser = async (): Promise<boolean> => {
  const info = await getCustomerInfo();
  if (!info) return false;
  try {
    return info.activeSubscriptions.length > 0;
  } catch {
    return false;
  }
};

export type UserTier = 'free' | 'pro' | 'max';

// Tier from RevenueCat entitlements (highest wins). This is the CLIENT-side read,
// used for display + the pre-upload gate. The edge function independently re-verifies
// tier server-side (RevenueCat REST) and never trusts this value for enforcement.
//
// MANUAL FOLLOW-UP: the 'pro' and 'max' entitlements must be created in the RevenueCat
// dashboard (and mapped to the App Store products) once the Apple Developer account is
// approved. Until then every user resolves to 'free' here, which is the safe default.
export const getUserTier = async (): Promise<UserTier> => {
  const info = await getCustomerInfo();
  if (!info) return 'free';
  try {
    const active = info.entitlements?.active ?? {};
    if (active['max']) return 'max';
    if (active['pro']) return 'pro';
    return 'free';
  } catch {
    return 'free';
  }
};

// Tie the RevenueCat app_user_id to the Supabase user id so the edge function can
// verify this user's subscription server-side via the RevenueCat REST API. Call once
// the signed-in user is known. No-op (safe) in Expo Go / when RC isn't configured.
export const identifyRevenueCatUser = async (userId: string): Promise<void> => {
  const P = await loadPurchases();
  if (!P || !userId) return;
  try {
    await P.logIn(userId);
  } catch {
    // Non-fatal — server-side verification simply falls back to 'free'.
  }
};

export const purchasePro = async (): Promise<{ success: boolean; error?: string }> => {
  const P = await loadPurchases();
  if (!P) return { success: false, error: 'Purchases not available in Expo Go' };
  try {
    const offerings = await P.getOfferings();
    const monthly = offerings.current?.monthly;
    if (!monthly) return { success: false, error: 'No offerings found' };
    await P.purchasePackage(monthly);
    return { success: true };
  } catch (e: any) {
    // User cancellation is a distinct, non-error signal — callers stay silent.
    if (e?.userCancelled) return { success: false, error: 'cancelled' };
    return { success: false, error: e?.message ?? 'Purchase failed' };
  }
};

const RESTORE_FAIL_MESSAGE =
  'No previous purchases found, or restore failed. Try again or contact support.';

export const restorePurchases = async (): Promise<{ success: boolean; error?: string }> => {
  const P = await loadPurchases();
  if (!P) return { success: false, error: RESTORE_FAIL_MESSAGE };
  try {
    const info = await P.restorePurchases();
    // A "successful" restore that finds no active entitlement isn't a real
    // restore — surface that rather than silently implying success.
    const hasActive = (info?.activeSubscriptions?.length ?? 0) > 0;
    if (!hasActive) return { success: false, error: RESTORE_FAIL_MESSAGE };
    return { success: true };
  } catch {
    return { success: false, error: RESTORE_FAIL_MESSAGE };
  }
};
