import { Pressable, StyleSheet, Text, View } from 'react-native';

import { border, colors, radius, type } from '../../constants/theme';
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
    paddingLeft: 56,
    paddingRight: 24,
    paddingTop: 8,
    paddingBottom: 24,
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
    marginTop: 24,
    gap: 12,
  },
  card: {
    width: '100%',
    padding: 20,
    borderRadius: radius.sharp,
    backgroundColor: colors.paper,
    ...border.hairline,
  },
  cardSelected: {
    ...border.rule,
  },
  styleName: {
    ...type.label,
    color: colors.graphite,
  },
  sample: {
    marginTop: 12,
    color: colors.ink,
  },
  // neat -> serif regular (upright)
  sampleNeat: {
    fontFamily: type.bodySerif.fontFamily,
    fontSize: 18,
  },
  // average -> serif italic
  sampleAverage: {
    fontFamily: type.bodySerif.fontFamily,
    fontStyle: 'italic',
    fontSize: 18,
  },
  // messy -> serif italic, tighter tracking
  sampleMessy: {
    fontFamily: type.bodySerif.fontFamily,
    fontStyle: 'italic',
    fontSize: 18,
    letterSpacing: -0.5,
  },
  footer: {
    marginTop: 'auto',
  },
});
