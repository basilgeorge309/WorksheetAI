import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { border, colors, radius, spacing, type } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { fillWorksheet } from '../../lib/worksheet';

// A pending/processing row older than this is treated as stalled (the edge
// function never finished — e.g. orphaned pre-auth test data).
const STALLED_MS = 5 * 60 * 1000;

type WorksheetStatus = 'pending' | 'processing' | 'complete' | 'error';

type Worksheet = {
  id: string;
  created_at: string;
  storage_path: string;
  output_path: string | null;
  status: WorksheetStatus;
  handwriting_style: string | null;
  difficulty: string | null;
  subject: string | null;
};

const BADGE_CONFIG: Record<WorksheetStatus, { label: string; bg: string; text: string }> = {
  complete: { label: 'Done', bg: colors.successGreenBg, text: colors.successGreen },
  processing: { label: 'Working…', bg: colors.paper, text: colors.ink },
  pending: { label: 'Pending', bg: colors.warningAmberBg, text: colors.warningAmber },
  error: { label: 'Failed', bg: colors.errorRedBg, text: colors.errorRed },
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const getFilename = (path: string) => path.split('/').pop() ?? path;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const getSubtitle = (w: Worksheet) => {
  const parts = [formatDate(w.created_at)];
  if (w.handwriting_style) parts.push(capitalize(w.handwriting_style));
  if (w.difficulty) parts.push(capitalize(w.difficulty));
  return parts.join(' · ');
};

function SkeletonRow() {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <View style={styles.row}>
      <View style={styles.iconWrap}>
        <Ionicons name="document-outline" size={24} color={colors.mutedText} />
      </View>
      <View style={styles.rowMiddle}>
        <Animated.View style={[styles.skelTitle, { opacity }]} />
        <Animated.View style={[styles.skelSubtitle, { opacity }]} />
      </View>
      <Animated.View style={[styles.skelBadge, { opacity }]} />
    </View>
  );
}

export default function HistoryScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [worksheets, setWorksheets] = useState<Worksheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const fetchHistory = async () => {
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error: queryError } = await supabase
      .from('worksheets')
      .select(
        'id, created_at, storage_path, output_path, status, handwriting_style, difficulty, subject'
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (queryError) setError(queryError.message);
    else setWorksheets((data as Worksheet[]) ?? []);
  };

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchHistory().finally(() => setLoading(false));
    }, [])
  );

  // Live-refresh: when a background fill flips a row to complete/error, refresh the
  // list even if the user is sitting on this tab (no tab-switch required).
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('worksheet-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'worksheets',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.new.status === 'complete' || payload.new.status === 'error') {
            fetchHistory();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchHistory();
    setRefreshing(false);
  };

  const openWorksheet = (w: Worksheet) => {
    router.push(
      `/worksheet/${w.id}?outputPath=${encodeURIComponent(w.output_path ?? '')}&status=${w.status}`
    );
  };

  const isStalled = (w: Worksheet) =>
    (w.status === 'pending' || w.status === 'processing') &&
    Date.now() - new Date(w.created_at).getTime() > STALLED_MS;

  // Re-invoke the edge function for a stalled worksheet using its stored values,
  // then refresh the list when it settles.
  const handleRetry = async (w: Worksheet) => {
    setError(null);
    setRetryingId(w.id);
    const result = await fillWorksheet(
      w.id,
      w.storage_path,
      w.handwriting_style ?? 'average',
      w.difficulty ?? 'realistic',
      w.subject ?? 'general'
    );
    setRetryingId(null);
    if ('error' in result) setError(result.error);
    await fetchHistory();
  };

  // Any in-flight worksheet drives a lightweight "filling in…" banner. The
  // useFocusEffect re-fetch above refreshes this whenever the tab regains focus.
  const hasProcessing = worksheets.some(
    (w) => w.status === 'pending' || w.status === 'processing'
  );

  const renderRow = ({ item }: { item: Worksheet }) => {
    const badge = BADGE_CONFIG[item.status] ?? BADGE_CONFIG.pending;
    const stalled = isStalled(item);
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => openWorksheet(item)}
        style={styles.row}>
        <View style={styles.iconWrap}>
          <Ionicons name="document-outline" size={24} color={colors.graphite} />
        </View>
        <View style={styles.rowMiddle}>
          <Text selectable={false} numberOfLines={1} style={styles.filename}>
            {getFilename(item.storage_path)}
          </Text>
          <Text selectable={false} style={styles.subtitle}>
            {getSubtitle(item)}
          </Text>
        </View>
        {stalled ? (
          <View style={styles.stalledGroup}>
            <View
              style={[
                styles.badge,
                { backgroundColor: colors.warningAmberBg, borderColor: colors.warningAmber },
              ]}>
              <Text selectable={false} style={[styles.badgeText, { color: colors.warningAmber }]}>
                Stalled
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.7}
              disabled={retryingId === item.id}
              onPress={() => handleRetry(item)}
              style={styles.retryButton}>
              {retryingId === item.id ? (
                <ActivityIndicator size="small" color={colors.ink} />
              ) : (
                <Text selectable={false} style={styles.retryText}>
                  Retry
                </Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.badge, { backgroundColor: badge.bg, borderColor: badge.text }]}>
            <Text selectable={false} style={[styles.badgeText, { color: badge.text }]}>
              {badge.label}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const Title = (
    <Text selectable={false} style={styles.title}>
      History
    </Text>
  );

  // Loading: skeletons.
  if (loading && !refreshing) {
    return (
      <View style={styles.container}>
        {Title}
        <View style={styles.skeletonList}>
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </View>
      </View>
    );
  }

  // Error.
  if (error) {
    return (
      <View style={styles.container}>
        {Title}
        <View style={styles.centered}>
          <Text selectable={false} style={styles.errorText}>
            Couldn&apos;t load history
          </Text>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => {
              setLoading(true);
              fetchHistory().finally(() => setLoading(false));
            }}>
            <Text selectable={false} style={styles.tryAgain}>
              Try again
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {Title}
      {hasProcessing && (
        <View style={styles.processingBanner}>
          <ActivityIndicator size="small" color={colors.ink} />
          <Text selectable={false} style={styles.processingBannerText}>
            Filling in your worksheet… this can take a couple of minutes.
          </Text>
        </View>
      )}
      <FlatList
        data={worksheets}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.ink}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="time-outline" size={48} color={colors.graphite} />
            </View>
            <Text selectable={false} style={styles.emptyTitle}>
              No worksheets yet
            </Text>
            <Text selectable={false} style={styles.emptySubtitle}>
              Upload your first one from the Home tab.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
    paddingRight: 24,
    paddingLeft: spacing.xl,
    borderLeftWidth: 2,
    borderLeftColor: colors.marginRed,
  },
  title: {
    ...type.displaySerif,
    color: colors.ink,
    paddingTop: 16,
    marginBottom: 8,
  },
  listContent: {
    paddingBottom: 100,
    flexGrow: 1,
  },
  processingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.paper,
    padding: 12,
    marginBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  processingBannerText: {
    ...type.small,
    color: colors.ink,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    padding: 16,
    marginBottom: spacing.sm,
    ...border.hairline,
  },
  iconWrap: {
    width: 32,
    alignItems: 'flex-start',
  },
  rowMiddle: {
    flex: 1,
    marginHorizontal: 12,
  },
  filename: {
    ...type.body,
    color: colors.ink,
  },
  subtitle: {
    marginTop: 4,
    ...type.small,
    color: colors.graphite,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    ...border.hairline,
  },
  badgeText: {
    ...type.label,
  },
  stalledGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  retryButton: {
    minWidth: 56,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  retryText: {
    ...type.label,
    color: colors.paper,
  },
  skeletonList: {
    marginTop: 4,
  },
  skelTitle: {
    width: 180,
    height: 14,
    borderRadius: radius.sm,
    backgroundColor: colors.cardBorder,
  },
  skelSubtitle: {
    marginTop: 8,
    width: 120,
    height: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.cardBorder,
  },
  skelBadge: {
    width: 52,
    height: 24,
    borderRadius: radius.sm,
    backgroundColor: colors.cardBorder,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    ...type.body,
    color: colors.errorRed,
    textAlign: 'center',
  },
  tryAgain: {
    marginTop: 12,
    ...type.body,
    fontWeight: '600',
    color: colors.ink,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: radius.pill,
    ...border.hairline,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    marginTop: 12,
    ...type.bodySerif,
    color: colors.graphite,
  },
  emptySubtitle: {
    marginTop: 4,
    ...type.small,
    color: colors.graphite,
    textAlign: 'center',
  },
});
