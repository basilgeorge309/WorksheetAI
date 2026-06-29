import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// EXPO_PUBLIC_* keys are bundled into the client app and are therefore public.
// The anon key is gated by Supabase Row Level Security — never ship a
// service-role key here.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// `createClient` throws on an empty URL/key, which would crash the app at launch
// before any screen renders. Until real keys are set in .env.local, fall back to
// a syntactically valid placeholder so the app still boots — auth calls then fail
// gracefully (caught in lib/auth.ts) instead of taking down the whole app.
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[supabase] Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Set them in .env.local — auth will not work until you do.'
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      // React Native has no localStorage — persist the session in AsyncStorage.
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // URL-based session detection is web-only; off for native.
      detectSessionInUrl: false,
    },
  }
);
