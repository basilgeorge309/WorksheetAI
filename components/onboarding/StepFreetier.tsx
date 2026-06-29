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
  const handleGoogle = () => runProvider('google', signInWithGoogle);

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
          <ActivityIndicator color="#FFFFFF" />
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
          <ActivityIndicator color="#1A1A1A" />
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
        placeholderTextColor="#6B6B6B"
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
        placeholderTextColor="#6B6B6B"
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
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
  },
  headerBlock: {
    width: '100%',
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 12,
    fontSize: 16,
    color: '#6B6B6B',
    textAlign: 'center',
  },
  barBlock: {
    marginTop: 32,
    width: '100%',
  },
  barTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E5E5E5',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563EB',
  },
  barCaption: {
    marginTop: 8,
    fontSize: 12,
    color: '#6B6B6B',
    textAlign: 'right',
  },
  appleButton: {
    marginTop: 24,
    width: '100%',
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  appleLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  googleButton: {
    marginTop: 12,
    width: '100%',
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  googleLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
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
    backgroundColor: '#E5E5E5',
  },
  orText: {
    fontSize: 12,
    color: '#6B6B6B',
  },
  input: {
    marginTop: 12,
    width: '100%',
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#1A1A1A',
    backgroundColor: '#FFFFFF',
  },
  inputTight: {
    marginTop: 8,
  },
  submitBlock: {
    marginTop: 8,
  },
  errorText: {
    marginTop: 12,
    fontSize: 13,
    color: '#DC2626',
  },
  infoText: {
    marginTop: 12,
    fontSize: 13,
    color: '#6B6B6B',
  },
  toggleWrap: {
    marginTop: 12,
    alignItems: 'center',
  },
  toggleText: {
    fontSize: 13,
    color: '#2563EB',
  },
});
