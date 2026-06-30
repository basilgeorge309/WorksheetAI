import { Ionicons } from '@expo/vector-icons';
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
import { Platform, StyleSheet, TouchableOpacity, useColorScheme } from 'react-native';
import 'react-native-reanimated';

import { AuthProvider, useAuth } from '../context/AuthContext';
import { colors } from '../constants/theme';
import {
  registerForPushNotifications,
  savePushToken,
} from '../lib/notifications';
import { identifyRevenueCatUser, initRevenueCat } from '../lib/revenuecat';

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

  // Once a user is signed in, register for push and save the token (best-effort;
  // no-ops gracefully in Expo Go / simulators).
  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) return;
    // Map RevenueCat's app_user_id to the Supabase user so the edge function can
    // verify this user's tier server-side.
    identifyRevenueCatUser(userId);
    registerForPushNotifications().then((token) => {
      if (token) savePushToken(userId, token);
    });
  }, [userId]);

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
    } else if (session && inOnboarding && !__DEV__) {
      // In dev, allow a signed-in user to stay on /onboarding for the screenshot
      // preview (Settings → "Preview onboarding"). In production this bounce
      // still applies so a logged-in user is never stranded on onboarding.
      router.replace('/(tabs)');
    }
  }, [session, loading, segments, router]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen
          name="worksheet/[id]"
          options={{
            headerTitle: '',
            headerStyle: { backgroundColor: colors.paper },
            headerShadowVisible: false,
            headerTintColor: colors.ink,
            headerLeft: () => (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Go back"
                activeOpacity={0.7}
                onPress={() => router.back()}
                style={styles.backButton}>
                <Ionicons name="arrow-back" size={18} color={colors.ink} />
              </TouchableOpacity>
            ),
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.ink,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
});
