import { StyleSheet, View } from 'react-native';

import { border, colors, radius } from '../../constants/theme';

type Props = {
  total: number;
  current: number;
};

export default function ProgressDots({ total, current }: Props) {
  return (
    <View style={styles.row}>
      {Array.from({ length: total }).map((_, i) => {
        const isCurrent = i === current;
        return (
          <View
            key={i}
            style={[styles.square, isCurrent ? styles.squareActive : styles.squareInactive]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  square: {
    width: 10,
    height: 10,
    borderRadius: radius.sharp,
  },
  squareActive: {
    backgroundColor: colors.ink,
    ...border.rule,
  },
  squareInactive: {
    backgroundColor: 'transparent',
    ...border.rule,
  },
});
