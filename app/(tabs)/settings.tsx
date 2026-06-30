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

import DeleteAccountModal from '../../components/DeleteAccountModal';
import PaywallModal from '../../components/PaywallModal';
import { useAuth } from '../../context/AuthContext';
import { isProUser, restorePurchases } from '../../lib/revenuecat';
import { border, colors, radius, shadow, type } from '../../constants/theme';

const TERMS_URL = 'https://basilgeorge309.github.io/WorksheetAI/terms.html';
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
  const [deleteVisible, setDeleteVisible] = useState(false);

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
      <View style={styles.card}>
        <Text style={styles.email}>
          {user?.email ?? 'Not signed in'}
        </Text>
      </View>

      {/* Subscription */}
      <Text style={styles.sectionLabel}>Subscription</Text>
      <View style={styles.card}>
        <View style={styles.planRow}>
          <Text style={styles.planText}>Plan</Text>
          <View style={[styles.badge, isPro ? styles.badgePro : styles.badgeFree]}>
            <Text style={[styles.badgeText, isPro ? styles.badgeTextPro : styles.badgeTextFree]}>
              {isPro === null ? '…' : isPro ? 'Pro' : 'Free'}
            </Text>
          </View>
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
          <ActivityIndicator color={colors.graphite} />
        ) : (
          <Text style={styles.restoreText}>Restore purchases</Text>
        )}
      </Pressable>

      {/* Legal */}
      <Text style={styles.sectionLabel}>Legal</Text>
      <View style={styles.card}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => Linking.openURL(TERMS_URL)}
          style={styles.legalRow}>
          <Text style={styles.legalText}>Terms of Service</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.graphite} />
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => Linking.openURL(PRIVACY_URL)}
          style={styles.legalRow}>
          <Text style={styles.legalText}>Privacy Policy</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.graphite} />
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => Linking.openURL(SUPPORT_URL)}
          style={[styles.legalRow, styles.legalRowLast]}>
          <Text style={styles.legalText}>Support</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.graphite} />
        </TouchableOpacity>
      </View>

      <View style={styles.spacer} />

      <View style={styles.footer}>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={handleSignOut}
          style={[styles.signOutButton, busy && styles.signOutButtonDisabled]}>
          {busy ? (
            <ActivityIndicator color={colors.alertRed} />
          ) : (
            <Text style={styles.signOutLabel}>Sign out</Text>
          )}
        </Pressable>

        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.7}
          onPress={() => setDeleteVisible(true)}
          style={styles.deleteRow}>
          <Text style={styles.deleteText}>Delete Account</Text>
        </TouchableOpacity>
      </View>

      <PaywallModal
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        onSuccess={() => {
          setPaywallVisible(false);
          refreshPro();
        }}
      />
      <DeleteAccountModal
        visible={deleteVisible}
        onClose={() => setDeleteVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    paddingLeft: 20,
    borderLeftWidth: 2,
    borderLeftColor: colors.marginRed,
    backgroundColor: colors.paper,
  },
  title: {
    ...type.titleSerif,
    color: colors.ink,
  },
  card: {
    marginTop: 8,
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    overflow: 'hidden',
    ...border.hairline,
  },
  email: {
    ...type.body,
    color: colors.graphite,
    paddingVertical: 12,
  },
  sectionLabel: {
    marginTop: 32,
    ...type.label,
    color: colors.mutedText,
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  legalRowLast: {
    borderBottomWidth: 0,
  },
  legalText: {
    ...type.body,
    color: colors.ink,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  planText: {
    ...type.body,
    color: colors.ink,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radius.sm,
    ...border.hairline,
  },
  badgeFree: {
    borderColor: colors.cardBorder,
    backgroundColor: colors.paper,
  },
  badgePro: {
    borderColor: colors.ink,
    backgroundColor: colors.paper,
  },
  badgeText: {
    ...type.label,
  },
  badgeTextFree: {
    color: colors.graphite,
  },
  badgeTextPro: {
    color: colors.ink,
  },
  upgradeButton: {
    marginTop: 16,
    width: '100%',
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
    ...shadow.button,
  },
  upgradeLabel: {
    ...type.buttonSerif,
    color: colors.paper,
  },
  restoreLink: {
    marginTop: 16,
    alignItems: 'center',
  },
  restoreText: {
    ...type.small,
    color: colors.graphite,
  },
  spacer: {
    flex: 1,
  },
  footer: {
    width: '100%',
  },
  errorText: {
    marginBottom: 12,
    ...type.small,
    color: colors.errorRed,
    textAlign: 'center',
  },
  signOutButton: {
    width: '100%',
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...border.hairline,
    backgroundColor: colors.paper,
  },
  signOutButtonDisabled: {
    opacity: 0.6,
  },
  signOutLabel: {
    ...type.body,
    fontWeight: '600',
    color: colors.alertRed,
  },
  deleteRow: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 14,
  },
  deleteText: {
    ...type.body,
    color: colors.alertRed,
  },
});

