import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import Confetti from '../../components/Confetti';
import OnboardingButton from '../../components/onboarding/OnboardingButton';
import { border, colors, radius, shadow, spacing, type } from '../../constants/theme';
import { supabase } from '../../lib/supabase';

export default function WorksheetDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    outputPath?: string;
    status?: string;
    style?: string;
  }>();
  const worksheetId = params.id;
  const outputPath = params.outputPath ?? '';
  const status = params.status ?? '';
  const styleParam = params.style;
  const showProcessing = status !== 'complete' && !outputPath;

  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ style: string | null; count: number | null }>({
    style: null,
    count: null,
  });

  // Celebration animations (fire once when the completed worksheet first shows).
  const [confettiOn, setConfettiOn] = useState(false);
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const celebratedRef = useRef(false);

  useEffect(() => {
    if (showProcessing || celebratedRef.current) return;
    celebratedRef.current = true; // once per completion, not on every re-render
    setConfettiOn(true);
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 5,
      tension: 80,
      useNativeDriver: true,
    }).start();
    Animated.timing(titleAnim, {
      toValue: 1,
      duration: 250,
      delay: 300,
      useNativeDriver: true,
    }).start();
    Animated.timing(contentAnim, {
      toValue: 1,
      duration: 200,
      delay: 500,
      useNativeDriver: true,
    }).start();
  }, [showProcessing, scaleAnim, titleAnim, contentAnim]);

  // Fetch the worksheet row for the real answer count + handwriting style
  // (used in the celebration subtitle). RLS limits this to the user's own row.
  useEffect(() => {
    let active = true;
    if (!worksheetId) return;
    (async () => {
      const { data } = await supabase
        .from('worksheets')
        .select('handwriting_style, answer_count')
        .eq('id', worksheetId)
        .single();
      if (!active || !data) return;
      setMeta({
        style: (data.handwriting_style as string | null) ?? null,
        count: (data.answer_count as number | null) ?? null,
      });
    })();
    return () => {
      active = false;
    };
  }, [worksheetId]);

  // Resolve a 1-hour signed URL for the (private) output PDF.
  useEffect(() => {
    let active = true;
    if (!outputPath) {
      setError('No output file for this worksheet yet.');
      return;
    }
    (async () => {
      const { data, error: signError } = await supabase.storage
        .from('worksheets')
        .createSignedUrl(outputPath, 3600);
      if (!active) return;
      if (signError || !data?.signedUrl) {
        setError(signError?.message ?? 'Could not load the worksheet.');
        return;
      }
      setSignedUrl(data.signedUrl);
    })();
    return () => {
      active = false;
    };
  }, [outputPath]);

  const localTarget = `${FileSystem.documentDirectory}${worksheetId}.pdf`;

  const ensureDownloaded = async (): Promise<string | null> => {
    if (!signedUrl) return null;
    const res = await FileSystem.downloadAsync(signedUrl, localTarget);
    return res.uri;
  };

  const handleDownload = async () => {
    setError(null);
    setDownloading(true);
    try {
      const uri = await ensureDownloaded();
      if (!uri) throw new Error('File is not ready yet.');
      // On mobile there's no shared "Downloads" folder; route through the share
      // sheet so the user can "Save to Files".
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  };

  const handleShare = async () => {
    setError(null);
    setShareLoading(true);
    try {
      const uri = await ensureDownloaded();
      if (!uri) throw new Error('File is not ready yet.');
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Sharing is not available on this device.');
      }
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Share failed.');
    } finally {
      setShareLoading(false);
    }
  };

  // Opened from History for a worksheet that isn't finished yet.
  if (showProcessing) {
    return (
      <View style={[styles.container, styles.processingContainer]}>
        <Ionicons name="hourglass-outline" size={48} color={colors.mutedText} />
        <Text selectable={false} style={styles.processingTitle}>
          Still working on it
        </Text>
        <Text selectable={false} style={styles.processingSubtitle}>
          Check back in a moment.
        </Text>
        <View style={styles.processingButton}>
          <OnboardingButton label="Go back" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  // Prefer real row data; fall back to the route's style param, then generic.
  const subtitleStyle = meta.style ?? styleParam;
  const subtitle =
    meta.count != null && subtitleStyle
      ? `${meta.count} questions answered, ${subtitleStyle}-style`
      : subtitleStyle
        ? `Answers filled in, ${subtitleStyle}-style.`
        : 'Your answers are filled in.';

  return (
    <View style={styles.container}>
      <Confetti trigger={confettiOn} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={() => router.back()}
        style={styles.backButton}>
        <Ionicons name="chevron-back" size={24} color={colors.graphite} />
      </Pressable>

      {/* Celebration header */}
      <View style={styles.celebration}>
        <Animated.View style={[styles.checkCircle, { transform: [{ scale: scaleAnim }] }]}>
          <Ionicons name="checkmark" size={32} color={colors.paper} />
        </Animated.View>
        <Animated.Text selectable={false} style={[styles.celebrateTitle, { opacity: titleAnim }]}>
          Worksheet ready!
        </Animated.Text>
        <Animated.Text selectable={false} style={[styles.celebrateSubtitle, { opacity: titleAnim }]}>
          {subtitle}
        </Animated.Text>
      </View>

      <Animated.View style={[styles.preview, { opacity: contentAnim }]}>
        {signedUrl ? (
          <>
            <WebView
              source={{ uri: signedUrl }}
              style={styles.webview}
              onLoadStart={() => setPreviewLoading(true)}
              onLoadEnd={() => setPreviewLoading(false)}
            />
            {previewLoading && (
              <View style={styles.previewOverlay}>
                <ActivityIndicator color={colors.ink} />
              </View>
            )}
          </>
        ) : (
          <View style={styles.previewOverlay}>
            <Text selectable={false} style={styles.previewMessage}>
              {error ?? 'Preview unavailable — tap Download to view'}
            </Text>
          </View>
        )}
      </Animated.View>

      {error && signedUrl && (
        <Text selectable={false} style={styles.errorText}>
          {error}
        </Text>
      )}

      <Animated.View style={[styles.actions, { opacity: contentAnim }]}>
        <Pressable
          accessibilityRole="button"
          disabled={!signedUrl || downloading}
          onPress={handleDownload}
          style={[styles.actionButton, styles.downloadButton, (!signedUrl || downloading) && styles.dim]}>
          {downloading ? (
            <ActivityIndicator color={colors.paper} />
          ) : (
            <Text selectable={false} style={styles.downloadLabel}>
              Download
            </Text>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={!signedUrl || shareLoading}
          onPress={handleShare}
          style={[styles.actionButton, styles.shareButton, (!signedUrl || shareLoading) && styles.dim]}>
          {shareLoading ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text selectable={false} style={styles.shareLabel}>
              Share
            </Text>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    paddingRight: spacing.xxl,
    paddingLeft: spacing.xl,
    borderLeftWidth: 2,
    borderLeftColor: colors.marginRed,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  processingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  processingTitle: {
    marginTop: spacing.lg,
    ...type.titleSerif,
    color: colors.ink,
  },
  processingSubtitle: {
    marginTop: spacing.xs,
    ...type.small,
    color: colors.graphite,
  },
  processingButton: {
    marginTop: spacing.xxl,
    width: '100%',
  },
  celebration: {
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  // The ink "stamp" — minimal depth retained (the one allowed shadow).
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  celebrateTitle: {
    marginTop: spacing.lg,
    ...type.displaySerif,
    color: colors.ink,
    textAlign: 'center',
  },
  celebrateSubtitle: {
    marginTop: spacing.xs,
    ...type.bodySerif,
    color: colors.graphite,
    textAlign: 'center',
  },
  preview: {
    height: 400,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.paper,
    ...border.hairline,
  },
  webview: {
    flex: 1,
  },
  previewOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  previewMessage: {
    ...type.small,
    color: colors.graphite,
    textAlign: 'center',
  },
  actions: {
    marginTop: spacing.xl,
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadButton: {
    backgroundColor: colors.ink,
    ...shadow.button,
  },
  downloadLabel: {
    ...type.buttonSerif,
    color: colors.paper,
  },
  shareButton: {
    backgroundColor: 'transparent',
    ...border.hairline,
  },
  shareLabel: {
    ...type.buttonSerif,
    color: colors.ink,
  },
  dim: {
    opacity: 0.6,
  },
  errorText: {
    marginTop: spacing.md,
    ...type.small,
    color: colors.errorRed,
    textAlign: 'center',
  },
});
