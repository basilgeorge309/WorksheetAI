import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  AuthResult,
  signInWithApple,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from '../../lib/auth';
import { border, colors, radius, type } from '../../constants/theme';
import OnboardingButton from './OnboardingButton';

type Props = {
  // Called on successful authentication. The shell marks onboarding complete
  // (AsyncStorage `onboarding_complete` = 'true') and navigates to /(tabs)/.
  onNext: () => void;
};

type Provider = 'apple' | 'google' | 'email';

function hasSession(result: AuthResult): boolean {
  const data = result.data as { session?: unknown } | null;
  return !!data?.session;
}

export default function StepFreetier({ onNext }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(true);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const anyBusy = busy !== null;

  const handleSuccess = (result: AuthResult) => {
    if (hasSession(result)) {
      onNext();
    } else {
      // signUp succeeded but no session — email confirmation is enabled.
      setInfo('Check your email to confirm your account, then sign in.');
      setIsSignUp(false);
    }
  };

  const runProvider = async (provider: Provider, fn: () => Promise<AuthResult>) => {
    setError(null);
    setInfo(null);
    setBusy(provider);
    const result = await fn();
    setBusy(null);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    handleSuccess(result);
  };

  const handleApple = () => runProvider('apple', signInWithApple);

  const handleGoogle = async () => {
    setError(null);
    setInfo(null);
    setBusy('google');
    const { error: googleError } = await signInWithGoogle();
    setBusy(null);
    if (googleError?.message === 'cancelled') return; // silent
    if (googleError) {
      setError('Google sign in failed. Try email instead.');
      return;
    }
    // Success — let the shell mark onboarding complete + navigate to /(tabs)/.
    onNext();
  };

  const handleEmail = () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    runProvider('email', () =>
      isSignUp ? signUpWithEmail(email, password) : signInWithEmail(email, password)
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.headerBlock}>
        <Text selectable={false} style={styles.title}>
          You&apos;re in.
        </Text>
        <Text selectable={false} style={styles.subtitle}>
          3 free worksheets. No card needed.
        </Text>

        <View style={styles.barBlock}>
          <View style={styles.barTrack}>
            <View style={styles.barFill} />
          </View>
          <Text selectable={false} style={styles.barCaption}>
            3 of 3 worksheets remaining
          </Text>
        </View>
      </View>

      {/* Apple — black, white text (App Store requirement) */}
      <Pressable
        accessibilityRole="button"
        disabled={anyBusy}
        onPress={handleApple}
        style={[styles.appleButton, anyBusy && styles.buttonDimmed]}>
        {busy === 'apple' ? (
          <ActivityIndicator color={colors.paper} />
        ) : (
          <Text selectable={false} style={styles.appleLabel}>
            {'  Sign in with Apple'}
          </Text>
        )}
      </Pressable>

      {/* Google — white with border, dark text (brand requirement) */}
      <Pressable
        accessibilityRole="button"
        disabled={anyBusy}
        onPress={handleGoogle}
        style={[styles.googleButton, anyBusy && styles.buttonDimmed]}>
        {busy === 'google' ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text selectable={false} style={styles.googleLabel}>
            {'  Sign in with Google'}
          </Text>
        )}
      </Pressable>

      <View style={styles.dividerRow}>
        <View style={styles.hairline} />
        <Text selectable={false} style={styles.orText}>
          or
        </Text>
        <View style={styles.hairline} />
      </View>

      <TextInput
        style={styles.input}
        placeholder="Email address"
        placeholderTextColor={colors.graphite}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        editable={!anyBusy}
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={[styles.input, styles.inputTight]}
        placeholder="Password"
        placeholderTextColor={colors.graphite}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
        editable={!anyBusy}
        value={password}
        onChangeText={setPassword}
      />

      <View style={styles.submitBlock}>
        <OnboardingButton
          label={isSignUp ? 'Sign up' : 'Sign in'}
          onPress={handleEmail}
          disabled={anyBusy && busy !== 'email'}
          loading={busy === 'email'}
        />
      </View>

      {error && (
        <Text selectable={false} style={styles.errorText}>
          {error}
        </Text>
      )}
      {info && (
        <Text selectable={false} style={styles.infoText}>
          {info}
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={anyBusy}
        onPress={() => {
          setIsSignUp((v) => !v);
          setError(null);
          setInfo(null);
        }}
        style={styles.toggleWrap}>
          <Text selectable={false} style={styles.toggleText}>
            {isSignUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    paddingLeft: 56,
    paddingRight: 24,
    paddingTop: 8,
    paddingBottom: 24,
  },
  headerBlock: {
    width: '100%',
    alignItems: 'center',
  },
  title: {
    ...type.displaySerif,
    fontSize: 32,
    color: colors.ink,
    textAlign: 'center',
  },
  subtitle: {
    ...type.small,
    marginTop: 12,
    color: colors.graphite,
    textAlign: 'center',
  },
  barBlock: {
    marginTop: 32,
    width: '100%',
  },
  barTrack: {
    width: '100%',
    height: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.paper,
    ...border.hairline,
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    height: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.ink,
  },
  barCaption: {
    ...type.small,
    marginTop: 8,
    color: colors.graphite,
    textAlign: 'right',
  },
  appleButton: {
    marginTop: 24,
    width: '100%',
    height: 52,
    borderRadius: radius.sharp,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  appleLabel: {
    ...type.body,
    fontWeight: '600',
    color: colors.paper,
  },
  googleButton: {
    marginTop: 12,
    width: '100%',
    height: 52,
    borderRadius: radius.sharp,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
    ...border.rule,
  },
  googleLabel: {
    ...type.body,
    fontWeight: '600',
    color: colors.ink,
  },
  buttonDimmed: {
    opacity: 0.6,
  },
  dividerRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hairline: {
    flex: 1,
    height: 1,
    backgroundColor: colors.paperLine,
  },
  orText: {
    ...type.small,
    color: colors.graphite,
  },
  input: {
    ...type.body,
    marginTop: 12,
    width: '100%',
    height: 48,
    borderRadius: radius.sharp,
    ...border.hairline,
    paddingHorizontal: 16,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  inputTight: {
    marginTop: 8,
  },
  submitBlock: {
    marginTop: 8,
  },
  errorText: {
    ...type.small,
    marginTop: 12,
    color: colors.errorRed,
  },
  infoText: {
    ...type.small,
    marginTop: 12,
    color: colors.graphite,
  },
  toggleWrap: {
    marginTop: 12,
    alignItems: 'center',
  },
  toggleText: {
    ...type.small,
    color: colors.ink,
  },
});
