import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { supabase } from '../../lib/supabase';
import RuledBackground from '../../components/RuledBackground';
import { border, colors, radius, spacing, type } from '../../constants/theme';

type WorksheetStatus = 'pending' | 'processing' | 'complete' | 'error';

type Worksheet = {
  id: string;
  created_at: string;
  storage_path: string;
  output_path: string | null;
  status: WorksheetStatus;
  style: string | null;
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
  if (w.style) parts.push(capitalize(w.style));
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
        <Ionicons name="document-outline" size={24} color={colors.paperLine} />
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
  const [worksheets, setWorksheets] = useState<Worksheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = async () => {
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error: queryError } = await supabase
      .from('worksheets')
      .select(
        'id, created_at, storage_path, output_path, status, style, difficulty, subject'
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

  const renderRow = ({ item }: { item: Worksheet }) => {
    const badge = BADGE_CONFIG[item.status] ?? BADGE_CONFIG.pending;
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
        <View style={[styles.badge, { backgroundColor: badge.bg, borderColor: badge.text }]}>
          <Text selectable={false} style={[styles.badgeText, { color: badge.text }]}>
            {badge.label}
          </Text>
        </View>
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
        <RuledBackground />
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
        <RuledBackground />
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
      <RuledBackground />
      {Title}
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
    paddingHorizontal: 24,
    paddingLeft: 56,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderRadius: radius.sharp,
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
    borderRadius: radius.sharp,
    ...border.hairline,
  },
  badgeText: {
    ...type.label,
  },
  skeletonList: {
    marginTop: 4,
  },
  skelTitle: {
    width: 180,
    height: 14,
    borderRadius: radius.sharp,
    backgroundColor: colors.paperLine,
  },
  skelSubtitle: {
    marginTop: 8,
    width: 120,
    height: 12,
    borderRadius: radius.sharp,
    backgroundColor: colors.paperLine,
  },
  skelBadge: {
    width: 52,
    height: 24,
    borderRadius: radius.sharp,
    backgroundColor: colors.paperLine,
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
    ...border.dashed,
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
