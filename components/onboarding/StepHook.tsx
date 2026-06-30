import { StyleSheet, Text, View } from 'react-native';

import { colors, type } from '../../constants/theme';
import OnboardingButton from './OnboardingButton';

type Props = {
  onNext: () => void;
};

export default function StepHook({ onNext }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.spacer} />

      <View style={styles.headline}>
        <Text selectable={false} style={styles.line1}>
          Your homework.
        </Text>
        <Text selectable={false} style={styles.line2}>
          Done in seconds.
        </Text>
        <Text selectable={false} style={styles.body}>
          Upload any worksheet and get it back filled in — in your
          handwriting style.
        </Text>
      </View>

      <View style={styles.spacer} />

      <OnboardingButton label="Get started →" onPress={onNext} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingLeft: 56,
    paddingRight: 24,
    paddingBottom: 24,
  },
  spacer: {
    flex: 1,
  },
  headline: {
    width: '100%',
  },
  line1: {
    ...type.displaySerif,
    fontSize: 36,
    color: colors.ink,
  },
  line2: {
    ...type.displaySerif,
    fontSize: 36,
    color: colors.alertRed,
  },
  body: {
    ...type.small,
    marginTop: 16,
    lineHeight: 24,
    color: colors.graphite,
  },
});
