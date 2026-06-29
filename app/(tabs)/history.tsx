import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

type WorksheetRow = {
  id: string;
  storage_path: string;
  output_path: string | null;
  status: 'pending' | 'processing' | 'complete' | 'error';
  created_at: string;
};

const STATUS_COLORS: Record<string, string> = {
  complete: '#16A34A',
  processing: '#2563EB',
  pending: '#2563EB',
  error: '#DC2626',
};

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SkeletonRow() {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.skeleton, { opacity }]} />;
}

export default function HistoryScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<WorksheetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!user) return;
    setError(null);
    supabase
      .from('worksheets')
      .select('id, storage_path, output_path, status, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error: queryError }) => {
        if (queryError) {
          setError(queryError.message);
          setRows([]);
          return;
        }
        setRows((data as WorksheetRow[]) ?? []);
      });
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      setRows(null);
      load();
    }, [load])
  );

  if (rows === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>History</Text>
        <View style={styles.list}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>History</Text>
      {error && <Text style={styles.errorText}>{error}</Text>}
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No worksheets yet. Upload your first one.</Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={rows}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => {
            const color = STATUS_COLORS[item.status] ?? '#6B6B6B';
            const tappable = item.status === 'complete' && !!item.output_path;
            return (
              <Pressable
                disabled={!tappable}
                onPress={() =>
                  router.push(
                    `/worksheet/${item.id}?outputPath=${encodeURIComponent(item.output_path ?? '')}`
                  )
                }
                style={styles.row}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {basename(item.storage_path)}
                  </Text>
                  <Text style={styles.rowDate}>{formatDate(item.created_at)}</Text>
                </View>
                <View style={[styles.badge, { borderColor: color }]}>
                  <Text style={[styles.badgeText, { color }]}>{item.status}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  list: {
    marginTop: 20,
  },
  separator: {
    height: 1,
    backgroundColor: '#E5E5E5',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
  },
  rowMain: {
    flex: 1,
    marginRight: 12,
  },
  rowName: {
    fontSize: 15,
    color: '#1A1A1A',
  },
  rowDate: {
    marginTop: 4,
    fontSize: 12,
    color: '#6B6B6B',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#6B6B6B',
    textAlign: 'center',
  },
  errorText: {
    marginTop: 12,
    fontSize: 13,
    color: '#DC2626',
  },
  skeleton: {
    height: 56,
    borderRadius: 8,
    marginBottom: 12,
    backgroundColor: '#E5E5E5',
  },
});
