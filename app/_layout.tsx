import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  useRouter,
  useSegments,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import 'react-native-reanimated';

import { AuthProvider, useAuth } from '../context/AuthContext';
import { initRevenueCat } from '../lib/revenuecat';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before auth state resolves.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Initialize RevenueCat once on startup (no-op / safe fallback in Expo Go).
  useEffect(() => {
    initRevenueCat();
  }, []);

  // Hide the splash screen once we know whether there is a session.
  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync();
    }
  }, [loading]);

  // Auth gate. Wait until the first auth state resolves to avoid redirect thrash.
  useEffect(() => {
    if (loading) return;
    const inOnboarding = segments[0] === 'onboarding';

    if (!session && !inOnboarding) {
      router.replace('/onboarding');
    } else if (session && inOnboarding) {
      router.replace('/(tabs)');
    }
  }, [session, loading, segments, router]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="worksheet/[id]" options={{ title: 'Worksheet' }} />
      </Stack>
    </ThemeProvider>
  );
}
