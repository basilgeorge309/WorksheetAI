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

export const restorePurchases = async (): Promise<{ success: boolean }> => {
  const P = await loadPurchases();
  if (!P) return { success: false };
  try {
    await P.restorePurchases();
    return { success: true };
  } catch {
    return { success: false };
  }
};
