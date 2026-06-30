import { StyleSheet, View } from 'react-native';

import { colors, radius } from '../constants/theme';

type Props = {
  used: number;
  limit: number;
  isPro?: boolean;
};

// Segmented usage bar that reads left-to-right as "burning down": a segment is
// FILLED (dark = still available) when its index >= used, and gray (cardBorder =
// already used) otherwise. So used=0 -> [ink,ink,ink]; used=1 -> [gray,ink,ink];
// used=3 -> [gray,gray,gray]. Pro -> a single full green bar.
export default function UsageBar({ used, limit, isPro }: Props) {
  if (isPro) {
    return (
      <View style={styles.row}>
        <View style={[styles.segment, { backgroundColor: colors.successGreen }]} />
      </View>
    );
  }

  const segments = Array.from({ length: Math.max(0, limit) }, (_, i) => i >= used);

  return (
    <View style={styles.row}>
      {segments.map((available, i) => (
        <View
          key={i}
          style={[
            styles.segment,
            { backgroundColor: available ? colors.ink : colors.cardBorder },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 5 },
  segment: { flex: 1, height: 7, borderRadius: radius.sm },
});
