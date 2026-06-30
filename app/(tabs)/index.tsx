import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import OnboardingButton from '../../components/onboarding/OnboardingButton';
import PaywallModal from '../../components/PaywallModal';
import RuledBackground from '../../components/RuledBackground';
import { border, colors, radius, spacing, type } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { sendLocalNotification } from '../../lib/notifications';
import {
  checkUsage,
  fillWorksheet,
  FileType,
  uploadWorksheet,
} from '../../lib/worksheet';

type Style = 'neat' | 'average' | 'messy';
type Difficulty = 'perfect' | 'realistic' | 'student';
type Source = 'pdf' | 'camera' | 'photos';

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

const SOURCE_CHIPS: { value: Source; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'pdf', label: 'PDF', icon: 'document-outline' },
  { value: 'camera', label: 'Camera', icon: 'camera-outline' },
  { value: 'photos', label: 'Photos', icon: 'image-outline' },
];

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [source, setSource] = useState<Source | null>(null);
  const [fileType, setFileType] = useState<FileType | null>(null);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
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
  // Usage text: green when worksheets remain, red when out, neutral while loading.
  const usageColor =
    usage === null
      ? colors.graphite
      : !usage.isPro && remaining === 0
        ? colors.alertRed
        : colors.successGreen;

  const clearSelection = () => {
    setSource(null);
    setFileType(null);
    setFileUri(null);
    setFileName(null);
    setThumbnail(null);
    setError(null);
  };

  const handlePdf = async () => {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    setSource('pdf');
    setFileType('pdf');
    setFileUri(asset.uri);
    setFileName(asset.name ?? 'worksheet.pdf');
    setThumbnail(null);
  };

  const handleCamera = async () => {
    setError(null);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setError('Camera permission is required.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setSource('camera');
    setFileType('image');
    setFileUri(asset.uri);
    setFileName('Photo ' + new Date().toLocaleTimeString());
    setThumbnail(asset.uri);
  };

  const handlePhotos = async () => {
    setError(null);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library permission is required.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setSource('photos');
    setFileType('image');
    setFileUri(asset.uri);
    setFileName(asset.fileName ?? 'Photo');
    setThumbnail(asset.uri);
  };

  const onSourcePress = (value: Source) => {
    if (value === 'pdf') handlePdf();
    else if (value === 'camera') handleCamera();
    else handlePhotos();
  };

  const handleFill = async () => {
    if (!user || !fileUri || !fileType) return;
    setError(null);

    // 1. Usage gate — before any upload, so a blocked user doesn't burn a slot.
    const usageNow = await checkUsage(user.id);
    setUsage({ used: usageNow.used, limit: usageNow.limit, isPro: usageNow.isPro });
    if (!usageNow.canUse) {
      setPaywallVisible(true);
      return;
    }

    setLoading(true);

    // 3. Upload (PDF or image).
    const uploaded = await uploadWorksheet(fileUri, user.id, fileType);
    if ('error' in uploaded) {
      setError(uploaded.error);
      setLoading(false);
      return;
    }

    // 4. Fill. (Usage is counted server-side by the edge function — the client
    // can no longer write the usage table.)
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

    // 6. Notify, then navigate (never while loading is true).
    await sendLocalNotification(
      'Worksheet ready! 📝',
      'Your filled worksheet is ready to view.'
    );
    setLoading(false);
    router.push(
      `/worksheet/${uploaded.worksheetId}?outputPath=${encodeURIComponent(filled.outputPath)}`
    );
  };

  // Stay tappable when out of usage so the tap can open the paywall.
  const fillDisabled = !fileUri || loading;

  return (
    <View style={styles.root}>
      <RuledBackground />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.appName}>Scribbl</Text>
        <Text style={[styles.usageText, { color: usageColor }]}>
          {usage === null
            ? 'Checking your free worksheets…'
            : usage.isPro
              ? 'Pro — Unlimited'
              : `${remaining} of ${usage.limit} remaining this month`}
        </Text>

        {/* Source picker */}
        <Text style={styles.sectionLabel}>Add a worksheet</Text>
        <View style={styles.chipRow}>
          {SOURCE_CHIPS.map((chip) => {
            const selected = source === chip.value;
            return (
              <Pressable
                key={chip.value}
                disabled={loading}
                onPress={() => onSourcePress(chip.value)}
                style={[styles.sourceChip, selected && styles.sourceChipSelected]}>
                <Ionicons
                  name={chip.icon}
                  size={18}
                  color={selected ? colors.paper : colors.ink}
                />
                <Text style={[styles.sourceChipText, selected && styles.sourceChipTextSelected]}>
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Selected file / photo preview */}
        {fileUri && (
          <View style={styles.previewCard}>
            {fileType === 'image' && thumbnail ? (
              <Image source={{ uri: thumbnail }} style={styles.thumbnail} />
            ) : (
              <Ionicons name="document-text-outline" size={28} color={colors.ink} />
            )}
            <Text style={styles.fileName} numberOfLines={1}>
              {fileName}
            </Text>
            <Pressable disabled={loading} onPress={clearSelection}>
              <Text style={styles.changeLink}>Change</Text>
            </Pressable>
          </View>
        )}

        {/* Handwriting style — segmented control */}
        <Text style={styles.sectionLabel}>Handwriting style</Text>
        <View style={styles.segmented}>
          {STYLE_CHIPS.map((chip, i) => {
            const selected = chip.value === style;
            return (
              <Pressable
                key={chip.value}
                disabled={loading}
                onPress={() => setStyle(chip.value)}
                style={[
                  styles.segment,
                  i < STYLE_CHIPS.length - 1 && styles.segmentDivider,
                  selected && styles.segmentSelected,
                ]}>
                <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Difficulty — segmented control */}
        <Text style={styles.sectionLabel}>Difficulty</Text>
        <View style={styles.segmented}>
          {DIFFICULTY_CHIPS.map((chip, i) => {
            const selected = chip.value === difficulty;
            return (
              <Pressable
                key={chip.value}
                disabled={loading}
                onPress={() => setDifficulty(chip.value)}
                style={[
                  styles.segment,
                  i < DIFFICULTY_CHIPS.length - 1 && styles.segmentDivider,
                  selected && styles.segmentSelected,
                ]}>
                <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
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
    </View>
  );
}

// Map the chosen style onto a coarse subject hint for the AI. (Real subject
// selection comes from onboarding answers in a later session.)
function subjectFor(_style: Style): string {
  return 'general';
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  screen: {
    flex: 1,
  },
  content: {
    paddingRight: spacing.xxl,
    paddingLeft: 56,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxl,
  },
  appName: {
    ...type.displaySerif,
    color: colors.ink,
  },
  usageText: {
    ...type.label,
    marginTop: spacing.sm,
  },
  sourceChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    borderRadius: radius.sharp,
    backgroundColor: colors.paper,
    ...border.hairline,
  },
  sourceChipSelected: {
    backgroundColor: colors.ink,
    ...border.rule,
  },
  sourceChipText: {
    ...type.body,
    color: colors.ink,
  },
  sourceChipTextSelected: {
    color: colors.paper,
  },
  previewCard: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sharp,
    backgroundColor: colors.paper,
    ...border.dashed,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: radius.sharp,
    ...border.hairline,
  },
  fileName: {
    flex: 1,
    ...type.bodySerif,
    color: colors.ink,
  },
  changeLink: {
    ...type.body,
    fontWeight: '600',
    color: colors.ink,
  },
  sectionLabel: {
    ...type.label,
    marginTop: spacing.xxl,
    color: colors.graphite,
  },
  chipRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    gap: spacing.md,
  },
  segmented: {
    marginTop: spacing.md,
    flexDirection: 'row',
    borderRadius: radius.sharp,
    overflow: 'hidden',
    ...border.rule,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    backgroundColor: 'transparent',
  },
  segmentDivider: {
    borderRightWidth: 1.5,
    borderRightColor: colors.ink,
  },
  segmentSelected: {
    backgroundColor: colors.ink,
  },
  segmentText: {
    ...type.bodySerif,
    fontSize: 15,
    color: colors.ink,
  },
  segmentTextSelected: {
    color: colors.paper,
  },
  errorText: {
    ...type.small,
    marginTop: spacing.xl,
    color: colors.errorRed,
  },
  fillBlock: {
    marginTop: spacing.xxl,
  },
});
