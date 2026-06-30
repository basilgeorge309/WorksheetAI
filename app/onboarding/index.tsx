import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../../constants/theme';
import RuledBackground from '../../components/RuledBackground';
import ProgressDots from '../../components/onboarding/ProgressDots';
import StepBehind from '../../components/onboarding/StepBehind';
import StepFreetier from '../../components/onboarding/StepFreetier';
import StepHandwriting from '../../components/onboarding/StepHandwriting';
import StepHook from '../../components/onboarding/StepHook';
import StepSubject from '../../components/onboarding/StepSubject';

const TOTAL_STEPS = 5;

type Answers = {
  subject: string | null;
  behind: string | null;
  style: string;
};

export default function OnboardingShell() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({
    subject: null,
    behind: null,
    style: 'average',
  });

  // Step-transition animation: translateX 40 -> 0, opacity 0 -> 1 over 250ms.
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [currentStep, anim]);

  // Hardware back (Android): go to the previous STEP, not the previous route.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (currentStep > 0) {
        setCurrentStep((s) => s - 1);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [currentStep]);

  const handleAnswer = (key: keyof Answers, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const goBack = () => {
    setCurrentStep((s) => Math.max(0, s - 1));
  };

  const handleNext = async () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep((s) => s + 1);
      return;
    }
    // Final step complete — mark onboarding done and enter the app.
    try {
      await AsyncStorage.setItem('onboarding_complete', 'true');
    } catch {
      // Non-fatal: if persistence fails we still let them into the app.
    }
    router.replace('/(tabs)');
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <StepHook onNext={handleNext} />;
      case 1:
        return (
          <StepSubject
            onNext={handleNext}
            onAnswer={handleAnswer}
            selected={answers.subject}
          />
        );
      case 2:
        return (
          <StepBehind
            onNext={handleNext}
            onAnswer={handleAnswer}
            selected={answers.behind}
          />
        );
      case 3:
        return (
          <StepHandwriting
            onNext={handleNext}
            onAnswer={handleAnswer}
            currentStyle={answers.style}
          />
        );
      case 4:
        return <StepFreetier onNext={handleNext} />;
      default:
        return null;
    }
  };

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [40, 0],
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <RuledBackground />
      {currentStep > 0 && (
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={goBack}
            style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
          <View style={styles.dotsWrap}>
            {/* Dots represent the 4 steps after the hook (steps 1–4). */}
            <ProgressDots total={TOTAL_STEPS - 1} current={currentStep - 1} />
          </View>
          <View style={styles.headerSpacer} />
        </View>
      )}

      <Animated.View
        style={[styles.content, { opacity: anim, transform: [{ translateX }] }]}>
        {renderStep()}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  dotsWrap: {
    flex: 1,
    alignItems: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
  },
});
