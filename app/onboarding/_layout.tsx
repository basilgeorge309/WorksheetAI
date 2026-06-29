import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Onboarding is a single route; steps are swapped in-screen, so no
        // per-step gestures are needed here.
        gestureEnabled: false,
        contentStyle: { backgroundColor: '#FFFFFF' },
      }}
    />
  );
}
