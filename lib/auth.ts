import * as AuthSession from 'expo-auth-session';
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
 * Pull a single query/fragment param out of a redirect URL. Used to read the
 * OAuth `code` without relying on Hermes's incomplete `URL.searchParams`.
 */
function getRedirectParam(url: string, key: string): string | null {
  const parts = url.split(/[?#]/);
  parts.shift(); // drop the scheme + path, keep param chunks
  for (const pair of parts.join('&').split('&')) {
    if (!pair) continue;
    const [k, v] = pair.split('=');
    if (decodeURIComponent(k) === key) return decodeURIComponent(v ?? '');
  }
  return null;
}

/**
 * Google OAuth via Supabase + expo-auth-session (PKCE code exchange). Opens a
 * browser, then exchanges the returned code for a Supabase session. Works in a
 * dev/standalone build; no native module. Requires the Supabase Google provider
 * + redirect URL configured (see dashboard checklist).
 */
export async function signInWithGoogle(): Promise<AuthResult> {
  try {
    const redirectTo = AuthSession.makeRedirectUri({
      scheme: 'worksheetai',
      path: 'auth/callback',
      preferLocalhost: false,
    });

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
      const code = getRedirectParam(result.url, 'code');
      if (code) {
        const { data: sessionData, error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);
        return {
          data: sessionData,
          error: exchangeError ? normalizeError(exchangeError) : null,
        };
      }
      return { data: null, error: { message: 'Authentication failed' } };
    }

    if (result.type === 'cancel' || result.type === 'dismiss') {
      return { data: null, error: { message: 'cancelled' } };
    }

    return { data: null, error: { message: 'Authentication failed' } };
  } catch (e) {
    return { data: null, error: normalizeError(e) };
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

/**
 * Permanently delete the signed-in user's account via the `delete-account` edge
 * function (which needs the service role to remove the auth user + storage), then
 * sign out locally. Returns `{ success, error? }`; never throws.
 *
 * 3.1 — Re-signup after deletion: the edge function calls
 * `adminClient.auth.admin.deleteUser(user.id)`, which removes the row from
 * `auth.users` entirely. Supabase frees the email immediately, so the same email
 * can sign up again right away as a brand-new account (no cooldown, no orphaned
 * row — `profiles/worksheets/usage` cascade-delete via FK). No extra code needed.
 */
export async function deleteAccount(): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not signed in' };

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { error } = await supabase.functions.invoke('delete-account', {
      headers: session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : undefined,
    });
    if (error) return { success: false, error: error.message };

    await supabase.auth.signOut();
    return { success: true };
  } catch (e) {
    return { success: false, error: normalizeError(e).message };
  }
}
