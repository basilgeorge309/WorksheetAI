import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import OnboardingButton from './OnboardingButton';

type Props = {
  onNext: () => void;
  onAnswer: (key: 'style', value: string) => void;
  currentStyle: string;
};

const SAMPLE = 'The mitochondria is the powerhouse of the cell.';

export default function StepHandwriting({ onNext, onAnswer, currentStyle }: Props) {
  const options = [
    { value: 'neat', name: 'Neat', sampleStyle: styles.sampleNeat },
    { value: 'average', name: 'Average', sampleStyle: styles.sampleAverage },
    { value: 'messy', name: 'Messy', sampleStyle: styles.sampleMessy },
  ];

  return (
    <View style={styles.container}>
      <Text selectable={false} style={styles.header}>
        Pick your handwriting style
      </Text>
      <Text selectable={false} style={styles.subheader}>
        This is how your worksheet will look.
      </Text>

      <View style={styles.cards}>
        {options.map((option) => {
          const isSelected = currentStyle === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              onPress={() => onAnswer('style', option.value)}
              style={[styles.card, isSelected && styles.cardSelected]}>
              <Text selectable={false} style={styles.styleName}>
                {option.name}
              </Text>
              <Text selectable={false} style={[styles.sample, option.sampleStyle]}>
                {SAMPLE}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.footer}>
        <OnboardingButton label="Looks good →" onPress={onNext} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
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
    marginTop: 24,
    gap: 12,
  },
  card: {
    width: '100%',
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
  },
  cardSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  styleName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B6B6B',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sample: {
    marginTop: 12,
    color: '#1A1A1A',
  },
  // neat -> monospace
  sampleNeat: {
    fontFamily: Platform.select({ ios: 'Courier New', default: 'monospace' }),
    fontSize: 18,
  },
  // average -> system italic
  sampleAverage: {
    fontStyle: 'italic',
    fontSize: 18,
  },
  // messy -> system italic, tighter tracking
  sampleMessy: {
    fontStyle: 'italic',
    fontSize: 18,
    letterSpacing: -0.5,
  },
  footer: {
    marginTop: 'auto',
  },
});
