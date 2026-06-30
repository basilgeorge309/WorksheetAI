import NetInfo from '@react-native-community/netinfo';

/**
 * Quick connectivity check used to fail fast before starting a network flow.
 * `isInternetReachable` can be null (unknown) on some platforms, so we only
 * treat an explicit `false` as offline.
 */
export async function isConnected(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected === true && state.isInternetReachable !== false;
  } catch {
    // If the check itself fails, don't block the user — let the actual request
    // surface its own error (timeouts/handlers downstream cover the hang case).
    return true;
  }
}
