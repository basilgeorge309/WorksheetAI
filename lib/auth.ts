import { makeRedirectUri } from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';

// Ensure the auth popup can be dismissed/completed when control returns to the app.
WebBrowser.maybeCompleteAuthSession();

export type AuthResult = { data: unknown; error: { message: string } | null };

function normalizeError(error: unknown): { message: string } {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return { message };
    }
  }
  return { message: 'Something went wrong. Please try again.' };
}

/**
 * Parse access/refresh tokens out of a redirect URL. Supabase's implicit OAuth
 * flow returns them in the URL fragment (#) and/or query (?). We merge both.
 */
function parseRedirectParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = url.split(/[?#]/);
  parts.shift(); // drop the scheme + path, keep param chunks
  const merged = parts.join('&');
  for (const pair of merged.split('&')) {
    if (!pair) continue;
    const [k, v] = pair.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  }
  return out;
}

async function createSessionFromUrl(url: string): Promise<AuthResult> {
  const params = parseRedirectParams(url);
  if (params.error_description) {
    return { data: null, error: { message: params.error_description } };
  }
  const { access_token, refresh_token } = params;
  if (!access_token || !refresh_token) {
    return { data: null, error: { message: 'No session returned from provider.' } };
  }
  const { data, error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });
  return { data, error: error ? normalizeError(error) : null };
}

/**
 * Google OAuth via expo-auth-session + Supabase. Requires a Supabase Google
 * provider config and the redirect URL registered (see dashboard checklist).
 */
export async function signInWithGoogle(): Promise<AuthResult> {
  try {
    const redirectTo = makeRedirectUri();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) return { data: null, error: normalizeError(error) };
    if (!data?.url) {
      return { data: null, error: { message: 'Could not start Google sign-in.' } };
    }

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === 'success' && result.url) {
      return createSessionFromUrl(result.url);
    }
    // User dismissed the browser — treat as a non-error cancellation.
    return { data: null, error: { message: 'Sign-in was cancelled.' } };
  } catch (error) {
    return { data: null, error: normalizeError(error) };
  }
}

/**
 * Apple Sign-In via the native module. Lazy-required so importing this file
 * never touches native code in Expo Go (Apple auth needs a dev build).
 */
export async function signInWithApple(): Promise<AuthResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { appleAuth } = require('@invertase/react-native-apple-authentication');

    if (!appleAuth || !appleAuth.isSupported) {
      return {
        data: null,
        error: { message: 'Apple Sign-In needs a development build (not Expo Go).' },
      };
    }

    // Supabase verifies the nonce: send the SHA-256 hash to Apple, the raw value
    // to Supabase.
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce
    );

    const response = await appleAuth.performRequest({
      requestedOperation: appleAuth.Operation.LOGIN,
      requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
      nonce: hashedNonce,
    });

    const identityToken: string | null = response?.identityToken ?? null;
    if (!identityToken) {
      return { data: null, error: { message: 'No identity token returned from Apple.' } };
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: identityToken,
      nonce: rawNonce,
    });
    return { data, error: error ? normalizeError(error) : null };
  } catch (error) {
    return { data: null, error: normalizeError(error) };
  }
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<AuthResult> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return { data, error: error ? normalizeError(error) : null };
  } catch (error) {
    return { data: null, error: normalizeError(error) };
  }
}

export async function signUpWithEmail(
  email: string,
  password: string
): Promise<AuthResult> {
  try {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    return { data, error: error ? normalizeError(error) : null };
  } catch (error) {
    return { data: null, error: normalizeError(error) };
  }
}

export async function signOut(): Promise<AuthResult> {
  try {
    const { error } = await supabase.auth.signOut();
    return { data: null, error: error ? normalizeError(error) : null };
  } catch (error) {
    return { data: null, error: normalizeError(error) };
  }
}

export async function getCurrentUser(): Promise<AuthResult> {
  try {
    const { data, error } = await supabase.auth.getUser();
    return { data, error: error ? normalizeError(error) : null };
  } catch (error) {
    return { data: null, error: normalizeError(error) };
  }
}
