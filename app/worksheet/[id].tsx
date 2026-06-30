import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import OnboardingButton from '../../components/onboarding/OnboardingButton';
import { supabase } from '../../lib/supabase';

export default function WorksheetDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    outputPath?: string;
    status?: string;
  }>();
  const worksheetId = params.id;
  const outputPath = params.outputPath ?? '';
  const status = params.status ?? '';
  const showProcessing = status !== 'complete' && !outputPath;

  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <Ionicons name="hourglass-outline" size={48} color="#D1D5DB" />
        <Text style={styles.processingTitle}>Still working on it</Text>
        <Text style={styles.processingSubtitle}>Check back in a moment.</Text>
        <View style={styles.processingButton}>
          <OnboardingButton label="Go back" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={() => router.back()}
        style={styles.backButton}>
        <Ionicons name="chevron-back" size={24} color="#6B6B6B" />
      </Pressable>

      <Text style={styles.title}>Your worksheet</Text>

      <View style={styles.preview}>
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
                <ActivityIndicator color="#2563EB" />
              </View>
            )}
          </>
        ) : (
          <View style={styles.previewOverlay}>
            <Text style={styles.previewMessage}>
              {error ?? 'Preview unavailable — tap Download to view'}
            </Text>
          </View>
        )}
      </View>

      {error && signedUrl && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={!signedUrl || downloading}
          onPress={handleDownload}
          style={[styles.actionButton, styles.downloadButton, (!signedUrl || downloading) && styles.dim]}>
          {downloading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.downloadLabel}>Download</Text>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={!signedUrl || shareLoading}
          onPress={handleShare}
          style={[styles.actionButton, styles.shareButton, (!signedUrl || shareLoading) && styles.dim]}>
          {shareLoading ? (
            <ActivityIndicator color="#1A1A1A" />
          ) : (
            <Text style={styles.shareLabel}>Share</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 24,
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
    marginTop: 16,
    fontSize: 20,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  processingSubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#6B6B6B',
  },
  processingButton: {
    marginTop: 24,
    width: '100%',
  },
  title: {
    marginTop: 8,
    fontSize: 24,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  preview: {
    marginTop: 20,
    height: 400,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
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
    padding: 16,
  },
  previewMessage: {
    fontSize: 14,
    color: '#6B6B6B',
    textAlign: 'center',
  },
  actions: {
    marginTop: 20,
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadButton: {
    backgroundColor: '#2563EB',
  },
  downloadLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  shareButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  shareLabel: {
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
});
