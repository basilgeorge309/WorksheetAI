import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import OnboardingButton from '../../components/onboarding/OnboardingButton';
import PaywallModal from '../../components/PaywallModal';
import { useAuth } from '../../context/AuthContext';
import {
  checkUsage,
  fillWorksheet,
  incrementUsage,
  uploadWorksheet,
} from '../../lib/worksheet';

type Style = 'neat' | 'average' | 'messy';
type Difficulty = 'perfect' | 'realistic' | 'student';

const STYLE_CHIPS: { value: Style; label: string }[] = [
  { value: 'neat', label: 'Neat' },
  { value: 'average', label: 'Average' },
  { value: 'messy', label: 'Messy' },
];

const DIFFICULTY_CHIPS: { value: Difficulty; label: string }[] = [
  { value: 'perfect', label: 'Perfect' },
  { value: 'realistic', label: 'Realistic' },
  { value: 'student', label: 'Student' },
];

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [file, setFile] = useState<{ uri: string; name: string } | null>(null);
  const [style, setStyle] = useState<Style>('average');
  const [difficulty, setDifficulty] = useState<Difficulty>('realistic');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{
    used: number;
    limit: number;
    isPro: boolean;
  } | null>(null);
  const [paywallVisible, setPaywallVisible] = useState(false);

  const refreshUsage = useCallback(() => {
    if (!user) return;
    checkUsage(user.id).then((u) =>
      setUsage({ used: u.used, limit: u.limit, isPro: u.isPro })
    );
  }, [user]);

  useFocusEffect(refreshUsage);

  const remaining = usage ? Math.max(0, usage.limit - usage.used) : null;

  const pickFile = async () => {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    setFile({ uri: asset.uri, name: asset.name ?? 'worksheet.pdf' });
  };

  const handleFill = async () => {
    if (!user || !file) return;
    setError(null);

    // 1. Usage gate — before any upload, so a blocked user doesn't burn a slot.
    const usageNow = await checkUsage(user.id);
    setUsage({ used: usageNow.used, limit: usageNow.limit, isPro: usageNow.isPro });
    if (!usageNow.canUse) {
      // Exhausted free tier — open the paywall instead of an inline error.
      setPaywallVisible(true);
      return;
    }

    setLoading(true);

    // 3. Upload.
    const uploaded = await uploadWorksheet(file.uri, user.id);
    if ('error' in uploaded) {
      setError(uploaded.error);
      setLoading(false);
      return;
    }

    // 4. Count the usage now that the upload succeeded.
    await incrementUsage(user.id);

    // 5. Fill.
    const filled = await fillWorksheet(
      uploaded.worksheetId,
      uploaded.storagePath,
      style,
      difficulty,
      subjectFor(style)
    );
    if ('error' in filled) {
      setError(filled.error);
      setLoading(false);
      return;
    }

    // 6. Done — then navigate (never while loading is true).
    setLoading(false);
    router.push(
      `/worksheet/${uploaded.worksheetId}?outputPath=${encodeURIComponent(filled.outputPath)}`
    );
  };

  // Stay tappable when out of usage so the tap can open the paywall.
  const fillDisabled = !file || loading;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.appName}>Scribbl</Text>
      <Text style={styles.usageText}>
        {usage === null
          ? 'Checking your free worksheets…'
          : usage.isPro
            ? 'Pro — Unlimited'
            : `${remaining} of ${usage.limit} remaining this month`}
      </Text>

      {/* Upload area */}
      <Pressable style={styles.uploadCard} onPress={pickFile} disabled={loading}>
        {file ? (
          <View style={styles.uploadFilled}>
            <Ionicons name="document-text-outline" size={28} color="#1A1A1A" />
            <Text style={styles.fileName} numberOfLines={1}>
              {file.name}
            </Text>
            <Text style={styles.changeLink}>Change</Text>
          </View>
        ) : (
          <View style={styles.uploadEmpty}>
            <Ionicons name="cloud-upload-outline" size={32} color="#6B6B6B" />
            <Text style={styles.uploadPrompt}>Tap to upload worksheet PDF</Text>
          </View>
        )}
      </Pressable>

      {/* Handwriting style */}
      <Text style={styles.sectionLabel}>Handwriting style</Text>
      <View style={styles.chipRow}>
        {STYLE_CHIPS.map((chip) => {
          const selected = chip.value === style;
          return (
            <Pressable
              key={chip.value}
              disabled={loading}
              onPress={() => setStyle(chip.value)}
              style={[styles.chip, selected && styles.chipSelected]}>
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Difficulty */}
      <Text style={styles.sectionLabel}>Difficulty</Text>
      <View style={styles.chipRow}>
        {DIFFICULTY_CHIPS.map((chip) => {
          const selected = chip.value === difficulty;
          return (
            <Pressable
              key={chip.value}
              disabled={loading}
              onPress={() => setDifficulty(chip.value)}
              style={[styles.chip, selected && styles.chipSelected]}>
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.fillBlock}>
        <OnboardingButton
          label="Fill it in →"
          onPress={handleFill}
          disabled={fillDisabled}
          loading={loading}
        />
      </View>

      <PaywallModal
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        onSuccess={() => {
          setPaywallVisible(false);
          refreshUsage();
        }}
      />
    </ScrollView>
  );
}

// Map the chosen style onto a coarse subject hint for the AI. (Real subject
// selection comes from onboarding answers in a later session.)
function subjectFor(_style: Style): string {
  return 'general';
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    padding: 24,
    paddingTop: 32,
  },
  appName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  usageText: {
    marginTop: 4,
    fontSize: 13,
    color: '#6B6B6B',
  },
  uploadCard: {
    marginTop: 24,
    height: 160,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#E5E5E5',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  uploadEmpty: {
    alignItems: 'center',
    gap: 10,
  },
  uploadPrompt: {
    fontSize: 15,
    color: '#6B6B6B',
  },
  uploadFilled: {
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  fileName: {
    fontSize: 15,
    color: '#1A1A1A',
    maxWidth: '100%',
  },
  changeLink: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563EB',
  },
  sectionLabel: {
    marginTop: 28,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#6B6B6B',
  },
  chipRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
  },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
  },
  chipSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  chipText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  chipTextSelected: {
    color: '#2563EB',
  },
  errorText: {
    marginTop: 20,
    fontSize: 13,
    color: '#DC2626',
  },
  fillBlock: {
    marginTop: 28,
  },
});
