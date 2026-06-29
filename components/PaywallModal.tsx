import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import OnboardingButton from './onboarding/OnboardingButton';
import { purchasePro, restorePurchases } from '../lib/revenuecat';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

type Busy = 'monthly' | 'annual' | 'restore' | null;

const FEATURES = [
  'Unlimited worksheets',
  'All handwriting styles',
  'Priority processing',
  'Download & share',
];

const EXPO_GO_MESSAGE = 'Upgrade available in the full app.';

export default function PaywallModal({ visible, onClose, onSuccess }: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const anyBusy = busy !== null;

  // Annual is wired to the monthly package for MVP (fixed in session 6).
  const handlePurchase = async (which: 'monthly' | 'annual') => {
    setError(null);
    setBusy(which);
    const res = await purchasePro();
    setBusy(null);
    if (res.success) {
      onSuccess();
      return;
    }
    if (res.error === 'cancelled') return; // silent — user backed out
    if (res.error === 'Purchases not available in Expo Go') {
      setError(EXPO_GO_MESSAGE);
      return;
    }
    setError(res.error ?? 'Something went wrong.');
  };

  const handleRestore = async () => {
    setError(null);
    setBusy('restore');
    const res = await restorePurchases();
    setBusy(null);
    if (res.success) {
      onSuccess();
      return;
    }
    setError('Could not restore purchases.');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.handle} />

          <Text selectable={false} style={styles.title}>
            You&apos;ve used your{'\n'}3 free worksheets.
          </Text>
          <Text selectable={false} style={styles.subtitle}>
            Upgrade to Pro for unlimited worksheets.
          </Text>

          <View style={styles.features}>
            {FEATURES.map((f) => (
              <View key={f} style={styles.featureRow}>
                <Ionicons name="checkmark" size={18} color="#2563EB" />
                <Text selectable={false} style={styles.featureText}>
                  {f}
                </Text>
              </View>
            ))}
          </View>

          <Text selectable={false} style={styles.price}>
            $4.99 / month
          </Text>
          <Text selectable={false} style={styles.priceSub}>
            or $29.99 / year (save 50%)
          </Text>

          <View style={styles.primaryBlock}>
            <OnboardingButton
              label="Start Pro — $4.99/mo"
              onPress={() => handlePurchase('monthly')}
              disabled={anyBusy && busy !== 'monthly'}
              loading={busy === 'monthly'}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={anyBusy}
            onPress={() => handlePurchase('annual')}
            style={[styles.annualButton, anyBusy && styles.dim]}>
            {busy === 'annual' ? (
              <ActivityIndicator color="#1A1A1A" />
            ) : (
              <Text selectable={false} style={styles.annualLabel}>
                Try Annual — $29.99/yr
              </Text>
            )}
          </Pressable>

          {error && (
            <Text selectable={false} style={styles.errorText}>
              {error}
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            disabled={anyBusy}
            onPress={handleRestore}
            style={styles.textLink}>
            {busy === 'restore' ? (
              <ActivityIndicator color="#6B6B6B" />
            ) : (
              <Text selectable={false} style={styles.textLinkLabel}>
                Restore purchases
              </Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={anyBusy}
            onPress={onClose}
            style={styles.textLink}>
            <Text selectable={false} style={styles.textLinkLabel}>
              Maybe later
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  backdropFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    height: 520,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5E5',
    marginBottom: 20,
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
  },
  features: {
    marginTop: 32,
    gap: 12,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureText: {
    fontSize: 15,
    color: '#1A1A1A',
  },
  price: {
    marginTop: 32,
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  priceSub: {
    marginTop: 4,
    fontSize: 13,
    color: '#6B6B6B',
  },
  primaryBlock: {
    marginTop: 24,
  },
  annualButton: {
    marginTop: 12,
    width: '100%',
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  annualLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  dim: {
    opacity: 0.6,
  },
  errorText: {
    marginTop: 12,
    fontSize: 13,
    color: '#DC2626',
    textAlign: 'center',
  },
  textLink: {
    marginTop: 12,
    alignItems: 'center',
  },
  textLinkLabel: {
    fontSize: 13,
    color: '#6B6B6B',
  },
});
