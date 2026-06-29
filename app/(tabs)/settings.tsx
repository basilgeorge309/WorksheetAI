import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '../../context/AuthContext';

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setError(null);
    setBusy(true);
    const { error: signOutError } = await signOut();
    if (signOutError) {
      setBusy(false);
      setError(signOutError.message);
      return;
    }
    // Forget that onboarding finished so the next launch starts fresh.
    try {
      await AsyncStorage.removeItem('onboarding_complete');
    } catch {
      // Non-fatal — routing is driven by session state regardless.
    }
    setBusy(false);
    router.replace('/onboarding');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>
          {user?.email ? `Signed in as ${user.email}` : 'Account and subscription options.'}
        </Text>
      </View>

      <View style={styles.footer}>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={handleSignOut}
          style={[styles.signOutButton, busy && styles.signOutButtonDisabled]}>
          {busy ? (
            <ActivityIndicator color="#DC2626" />
          ) : (
            <Text style={styles.signOutLabel}>Sign out</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 15,
    color: '#6B6B6B',
    textAlign: 'center',
  },
  footer: {
    width: '100%',
  },
  errorText: {
    marginBottom: 12,
    fontSize: 13,
    color: '#DC2626',
    textAlign: 'center',
  },
  signOutButton: {
    width: '100%',
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
  },
  signOutButtonDisabled: {
    opacity: 0.6,
  },
  signOutLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#DC2626',
  },
});
