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
  complete: { label: 'Done', bg: '#DCFCE7', text: '#16A34A' },
  processing: { label: 'Working…', bg: '#DBEAFE', text: '#2563EB' },
  pending: { label: 'Pending', bg: '#FEF9C3', text: '#CA8A04' },
  error: { label: 'Failed', bg: '#FEE2E2', text: '#DC2626' },
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
        <Ionicons name="document-outline" size={24} color="#E5E5E5" />
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
          <Ionicons name="document-outline" size={24} color="#6B6B6B" />
        </View>
        <View style={styles.rowMiddle}>
          <Text selectable={false} numberOfLines={1} style={styles.filename}>
            {getFilename(item.storage_path)}
          </Text>
          <Text selectable={false} style={styles.subtitle}>
            {getSubtitle(item)}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
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
      <FlatList
        data={worksheets}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563EB" />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="time-outline" size={48} color="#D1D5DB" />
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
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
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
    paddingVertical: 16,
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
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#6B6B6B',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  separator: {
    height: 1,
    backgroundColor: '#E5E5E5',
  },
  skeletonList: {
    marginTop: 4,
  },
  skelTitle: {
    width: 180,
    height: 14,
    borderRadius: 4,
    backgroundColor: '#E5E5E5',
  },
  skelSubtitle: {
    marginTop: 8,
    width: 120,
    height: 12,
    borderRadius: 4,
    backgroundColor: '#F0F0F0',
  },
  skelBadge: {
    width: 52,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E5E5E5',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 15,
    color: '#DC2626',
    textAlign: 'center',
  },
  tryAgain: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: '600',
    color: '#2563EB',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 17,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  emptySubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#6B6B6B',
    textAlign: 'center',
  },
});
