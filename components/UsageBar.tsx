import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, type } from '../constants/theme';
import { UserTier } from '../lib/revenuecat';

type Props = {
  tier?: UserTier;
  capType?: 'count' | 'cost'; // 'count' = free worksheet count; 'cost' = pro/max $ cap
  used: number; // count (free) or cents (pro/max)
  limit: number; // 3 (free) or cents (pro/max)
  isPro?: boolean;
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function UsageBar({ capType = 'count', used, limit, tier }: Props) {
  // Pro/Max: a continuous dollar progress bar + "$X.XX of $Y.YY used" label. The
  // 3-segment count bar doesn't map onto a dollar cap.
  if (capType === 'cost') {
    const pct = limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;
    const nearCap = pct >= 0.85;
    return (
      <View>
        <View style={styles.costTrack}>
          <View
            style={[
              styles.costFill,
              { width: `${pct * 100}%`, backgroundColor: nearCap ? colors.warningAmber : colors.successGreen },
            ]}
          />
        </View>
        <Text selectable={false} style={styles.costLabel}>
          {dollars(used)} of {dollars(limit)} used{tier === 'max' ? ' · Max' : ' · Pro'}
        </Text>
      </View>
    );
  }

  // Free: segmented "burning down" count bar. Segment i is FILLED (ink = available)
  // when i >= used, else gray. used=0 -> [ink,ink,ink]; used=3 -> [gray,gray,gray].
  const segments = Array.from({ length: Math.max(0, limit) }, (_, i) => i >= used);
  return (
    <View style={styles.row}>
      {segments.map((available, i) => (
        <View
          key={i}
          style={[styles.segment, { backgroundColor: available ? colors.ink : colors.cardBorder }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 5 },
  segment: { flex: 1, height: 7, borderRadius: radius.sm },
  costTrack: {
    width: '100%',
    height: 7,
    borderRadius: radius.sm,
    backgroundColor: colors.cardBorder,
    overflow: 'hidden',
  },
  costFill: {
    height: 7,
    borderRadius: radius.sm,
  },
  costLabel: {
    ...type.small,
    marginTop: 6,
    color: colors.graphite,
  },
});
