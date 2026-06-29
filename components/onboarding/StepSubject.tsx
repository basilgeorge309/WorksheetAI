import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  onNext: () => void;
  onAnswer: (key: 'subject', value: string) => void;
  selected?: string | null;
};

const OPTIONS: { value: string; label: string }[] = [
  { value: 'math', label: 'Math & problem sets' },
  { value: 'humanities', label: 'Reading & essays' },
  { value: 'science', label: 'Science labs' },
  { value: 'mixed', label: 'Mixed / everything' },
];

export default function StepSubject({ onNext, onAnswer, selected }: Props) {
  const [picked, setPicked] = useState<string | null>(selected ?? null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const handleSelect = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    setPicked(value);
    onAnswer('subject', value);
    timer.current = setTimeout(onNext, 300);
  };

  return (
    <View style={styles.container}>
      <Text selectable={false} style={styles.header}>
        What are you working on?
      </Text>
      <Text selectable={false} style={styles.subheader}>
        We&apos;ll match the AI&apos;s answers to your subject.
      </Text>

      <View style={styles.cards}>
        {OPTIONS.map((option) => {
          const isSelected = picked === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              onPress={() => handleSelect(option.value)}
              style={[styles.card, isSelected && styles.cardSelected]}>
              <Text
                selectable={false}
                style={[styles.cardLabel, isSelected && styles.cardLabelSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  header: {
    fontSize: 24,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  subheader: {
    marginTop: 8,
    fontSize: 14,
    color: '#6B6B6B',
  },
  cards: {
    marginTop: 32,
    gap: 12,
  },
  card: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
  },
  cardSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  cardLabel: {
    fontSize: 16,
    color: '#1A1A1A',
  },
  cardLabelSelected: {
    color: '#1A1A1A',
  },
});
