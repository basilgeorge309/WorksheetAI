import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { border, colors, radius, type } from '../../constants/theme';

type Props = {
  onNext: () => void;
  onAnswer: (key: 'behind', value: string) => void;
  selected?: string | null;
};

const OPTIONS: { value: string; label: string }[] = [
  { value: 'little', label: 'Just a little (1–2 assignments)' },
  { value: 'weeks', label: 'A few weeks worth' },
  { value: 'chaos', label: "...let's not talk about it" },
  { value: 'ontop', label: "I'm actually on top of things" },
];

export default function StepBehind({ onNext, onAnswer, selected }: Props) {
  const [picked, setPicked] = useState<string | null>(selected ?? null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const respectAnim = useRef(new Animated.Value(0)).current;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const handleSelect = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    setPicked(value);
    onAnswer('behind', value);

    if (value === 'ontop') {
      respectAnim.setValue(0);
      Animated.timing(respectAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      timer.current = setTimeout(onNext, 600);
    } else {
      timer.current = setTimeout(onNext, 300);
    }
  };

  return (
    <View style={styles.container}>
      <Text selectable={false} style={styles.header}>
        How far behind are you?
      </Text>
      <Text selectable={false} style={styles.subheader}>
        No judgment.
      </Text>

      <View style={styles.cards}>
        {OPTIONS.map((option) => {
          const isSelected = picked === option.value;
          return (
            <View key={option.value}>
              <Pressable
                accessibilityRole="button"
                onPress={() => handleSelect(option.value)}
                style={[styles.card, isSelected && styles.cardSelected]}>
                <Text
                  selectable={false}
                  style={[styles.cardLabel, isSelected && styles.cardLabelSelected]}>
                  {option.label}
                </Text>
              </Pressable>
              {option.value === 'ontop' && picked === 'ontop' && (
                <Animated.Text
                  selectable={false}
                  style={[styles.respect, { opacity: respectAnim }]}>
                  Respect. We&apos;ll still save you time.
                </Animated.Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingLeft: 56,
    paddingRight: 24,
    paddingTop: 8,
  },
  header: {
    ...type.displaySerif,
    color: colors.ink,
  },
  subheader: {
    ...type.small,
    marginTop: 8,
    color: colors.graphite,
  },
  cards: {
    marginTop: 32,
    gap: 12,
  },
  card: {
    width: '100%',
    padding: 16,
    borderRadius: radius.sharp,
    backgroundColor: colors.paper,
    ...border.hairline,
  },
  cardSelected: {
    backgroundColor: colors.ink,
    ...border.rule,
  },
  cardLabel: {
    ...type.body,
    color: colors.ink,
  },
  cardLabelSelected: {
    color: colors.paper,
  },
  respect: {
    ...type.small,
    marginTop: 8,
    marginLeft: 4,
    color: colors.graphite,
  },
});
