import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, shadow, type } from '../../constants/theme';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export default function OnboardingButton({
  label,
  onPress,
  disabled = false,
  loading = false,
}: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={[styles.button, isDisabled && styles.buttonDisabled]}>
      {loading ? (
        <ActivityIndicator color={colors.paper} />
      ) : (
        <Text
          selectable={false}
          style={[styles.label, isDisabled && styles.labelDisabled]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
    ...shadow.button,
  },
  buttonDisabled: {
    backgroundColor: colors.mutedText,
    shadowOpacity: 0,
    elevation: 0,
  },
  label: {
    ...type.buttonSerif,
    color: colors.paper,
  },
  labelDisabled: {
    color: colors.paper,
  },
});
