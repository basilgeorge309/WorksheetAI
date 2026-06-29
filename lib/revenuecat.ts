/**
 * RevenueCat initialization — placeholder.
 *
 * react-native-purchases is a NATIVE module. It does not run inside Expo Go;
 * it requires a development build (`npx expo run:ios` / `run:android` or EAS).
 * To keep the app runnable in Expo Go during scaffolding, we do NOT import
 * react-native-purchases at the top level — the import is deferred until
 * `initRevenueCat()` is actually called from a native build.
 *
 * Wire-up happens in a later session (paywall + entitlements).
 */

import { Platform } from 'react-native';

const apiKey =
  Platform.OS === 'ios'
    ? process.env.REVENUECAT_API_KEY_IOS
    : process.env.REVENUECAT_API_KEY_ANDROID;

/**
 * Configure RevenueCat. No-op until called from a native/dev build.
 * Lazy-requires the native module so importing this file never crashes Expo Go.
 */
export function initRevenueCat(): void {
  if (!apiKey) {
    console.warn('[revenuecat] No API key set for this platform yet.');
    return;
  }
  // Deferred require — only loaded in a native build, never in Expo Go.
  // const Purchases = require('react-native-purchases').default;
  // Purchases.configure({ apiKey });
  console.log('[revenuecat] initRevenueCat placeholder — wire up in a later session.');
}
