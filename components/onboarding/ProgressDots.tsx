import { StyleSheet, View } from 'react-native';

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
            style={[styles.dot, isCurrent ? styles.dotCurrent : styles.dotInactive]}
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
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotCurrent: {
    backgroundColor: '#2563EB',
    transform: [{ scale: 1.2 }],
  },
  dotInactive: {
    backgroundColor: '#E5E5E5',
  },
});
