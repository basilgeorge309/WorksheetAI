import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
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
import { border, colors, radius, shadow, type } from '../../constants/theme';
import OnboardingButton from './OnboardingButton';

// Same legal pages used in Settings.
const TERMS_URL = 'https://basilgeorge309.github.io/worksheetai/terms.html';
const PRIVACY_URL = 'https://basilgeorge309.github.io/worksheetai/privacy.html';

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
        {/* Header */}
        <View style={styles.header}>
          <Text selectable={false} style={styles.pencil}>
            ✏️
          </Text>
          <Text selectable={false} style={styles.title}>
            Welcome to Scribbl
          </Text>
          <Text selectable={false} style={styles.tagline}>
            Your handwriting, done in seconds.
          </Text>
        </View>

        {/* Body */}
        <View style={styles.body}>
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
                Continue with Apple
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
                Continue with Google
              </Text>
            )}
          </Pressable>

          {/* OR divider */}
          <View style={styles.dividerRow}>
            <View style={styles.hairline} />
            <Text selectable={false} style={styles.orText}>
              or
            </Text>
            <View style={styles.hairline} />
          </View>

          {/* Email */}
          <Text selectable={false} style={styles.fieldLabel}>
            Email
          </Text>
          <TextInput
            style={styles.input}
            placeholder="name@email.com"
            placeholderTextColor={colors.mutedText}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            editable={!anyBusy}
            value={email}
            onChangeText={setEmail}
          />

          {/* Password */}
          <Text selectable={false} style={[styles.fieldLabel, styles.fieldLabelSpaced]}>
            Password
          </Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor={colors.mutedText}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            editable={!anyBusy}
            value={password}
            onChangeText={setPassword}
          />

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

          {/* Primary — ink, serif-italic, label switches by mode */}
          <View style={styles.submitBlock}>
            <OnboardingButton
              label={isSignUp ? 'Create my account  →' : 'Sign in  →'}
              onPress={handleEmail}
              disabled={anyBusy && busy !== 'email'}
              loading={busy === 'email'}
            />
          </View>

          {/* Toggle */}
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
              {isSignUp ? 'Already have an account? ' : 'New here? '}
              <Text style={styles.toggleAction}>
                {isSignUp ? 'Sign in' : 'Create an account'}
              </Text>
            </Text>
          </Pressable>

          {/* Legal footer */}
          <Text selectable={false} style={styles.footerText}>
            By continuing, you agree to our{' '}
            <Text style={styles.footerLink} onPress={() => Linking.openURL(TERMS_URL)}>
              Terms
            </Text>
            {' and '}
            <Text style={styles.footerLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
              Privacy Policy
            </Text>
          </Text>
        </View>
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
    backgroundColor: colors.paper,
    paddingBottom: 28,
  },
  header: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 24,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  pencil: {
    fontSize: 44,
    lineHeight: 52,
    textAlign: 'center',
  },
  title: {
    ...type.displaySerif,
    fontSize: 26,
    marginTop: 10,
    color: colors.ink,
    textAlign: 'center',
  },
  tagline: {
    ...type.body,
    marginTop: 6,
    color: colors.graphite,
    textAlign: 'center',
  },
  body: {
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  appleButton: {
    width: '100%',
    height: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
    ...shadow.button,
  },
  appleLabel: {
    ...type.body,
    fontWeight: '700',
    color: colors.paper,
  },
  googleButton: {
    marginTop: 12,
    width: '100%',
    height: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
    ...border.hairline,
  },
  googleLabel: {
    ...type.body,
    fontWeight: '700',
    color: colors.ink,
  },
  buttonDimmed: {
    opacity: 0.6,
  },
  dividerRow: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  hairline: {
    flex: 1,
    height: 1,
    backgroundColor: colors.cardBorder,
  },
  orText: {
    ...type.label,
    color: colors.mutedText,
  },
  fieldLabel: {
    ...type.label,
    color: colors.mutedText,
    marginTop: 24,
    marginBottom: 8,
  },
  fieldLabelSpaced: {
    marginTop: 16,
  },
  input: {
    ...type.body,
    width: '100%',
    height: 50,
    borderRadius: radius.md,
    ...border.hairline,
    paddingHorizontal: 16,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  submitBlock: {
    marginTop: 24,
  },
  errorText: {
    ...type.small,
    marginTop: 16,
    color: colors.errorRed,
  },
  infoText: {
    ...type.small,
    marginTop: 16,
    color: colors.graphite,
  },
  toggleWrap: {
    marginTop: 20,
    alignItems: 'center',
  },
  toggleText: {
    ...type.small,
    color: colors.graphite,
  },
  toggleAction: {
    color: colors.ink,
    fontWeight: '700',
  },
  footerText: {
    marginTop: 20,
    fontSize: 11,
    lineHeight: 16,
    color: colors.mutedText,
    textAlign: 'center',
  },
  footerLink: {
    color: colors.graphite,
    textDecorationLine: 'underline',
  },
});
