import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import PaywallModal from '../../components/PaywallModal';
import { useAuth } from '../../context/AuthContext';
import { isProUser, restorePurchases } from '../../lib/revenuecat';

const PRIVACY_URL = 'https://basilgeorge309.github.io/WorksheetAI/privacy.html';
const SUPPORT_URL = 'https://basilgeorge309.github.io/WorksheetAI/support.html';

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);

  const refreshPro = useCallback(() => {
    isProUser().then(setIsPro);
  }, []);

  useFocusEffect(refreshPro);

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

  const handleRestore = async () => {
    setRestoring(true);
    await restorePurchases();
    setRestoring(false);
    refreshPro();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      {/* Account */}
      <Text style={styles.sectionLabel}>Account</Text>
      <Text style={styles.email}>
        {user?.email ?? 'Not signed in'}
      </Text>

      {/* Subscription */}
      <Text style={styles.sectionLabel}>Subscription</Text>
      <View style={styles.planRow}>
        <Text style={styles.planText}>Plan</Text>
        <View style={[styles.badge, isPro ? styles.badgePro : styles.badgeFree]}>
          <Text style={[styles.badgeText, isPro ? styles.badgeTextPro : styles.badgeTextFree]}>
            {isPro === null ? '…' : isPro ? 'Pro' : 'Free'}
          </Text>
        </View>
      </View>

      {isPro === false && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setPaywallVisible(true)}
          style={styles.upgradeButton}>
          <Text style={styles.upgradeLabel}>Upgrade to Pro</Text>
        </Pressable>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={restoring}
        onPress={handleRestore}
        style={styles.restoreLink}>
        {restoring ? (
          <ActivityIndicator color="#6B6B6B" />
        ) : (
          <Text style={styles.restoreText}>Restore purchases</Text>
        )}
      </Pressable>

      {/* Legal */}
      <Text style={styles.sectionLabel}>Legal</Text>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => Linking.openURL(PRIVACY_URL)}
        style={styles.legalRow}>
        <Text style={styles.legalText}>Privacy Policy</Text>
        <Ionicons name="chevron-forward" size={16} color="#6B6B6B" />
      </TouchableOpacity>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => Linking.openURL(SUPPORT_URL)}
        style={styles.legalRow}>
        <Text style={styles.legalText}>Support</Text>
        <Ionicons name="chevron-forward" size={16} color="#6B6B6B" />
      </TouchableOpacity>

      <View style={styles.spacer} />

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

      <PaywallModal
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        onSuccess={() => {
          setPaywallVisible(false);
          refreshPro();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  email: {
    fontSize: 14,
    color: '#6B6B6B',
    paddingVertical: 12,
  },
  sectionLabel: {
    marginTop: 32,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#6B6B6B',
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  legalText: {
    fontSize: 15,
    color: '#1A1A1A',
  },
  planRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  planText: {
    fontSize: 15,
    color: '#1A1A1A',
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  badgeFree: {
    borderColor: '#E5E5E5',
    backgroundColor: '#F3F4F6',
  },
  badgePro: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  badgeTextFree: {
    color: '#6B6B6B',
  },
  badgeTextPro: {
    color: '#2563EB',
  },
  upgradeButton: {
    marginTop: 16,
    width: '100%',
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
  },
  upgradeLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  restoreLink: {
    marginTop: 16,
    alignItems: 'center',
  },
  restoreText: {
    fontSize: 13,
    color: '#6B6B6B',
  },
  spacer: {
    flex: 1,
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
