import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from './supabase';

// SDK 56: shouldShowAlert is deprecated in favour of shouldShowBanner +
// shouldShowList. Show the banner + list, play a sound, don't touch the badge.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Register for push notifications and return the Expo push token, or null.
 * Fails gracefully: simulators, denied permission, Expo Go (no EAS projectId),
 * or any native error all return null instead of throwing.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      console.log('Push notifications require a physical device');
      return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    // A remote push token needs an EAS projectId — absent in Expo Go and until
    // EAS is configured. Without it getExpoPushTokenAsync throws, so guard it.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      console.log('No EAS projectId — skipping remote push token (local notifications still work)');
      return null;
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return token;
  } catch (e) {
    console.log('registerForPushNotifications failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Persist the Expo push token on the user's profile row. Best-effort. */
export async function savePushToken(userId: string, token: string): Promise<void> {
  try {
    await supabase.from('profiles').update({ push_token: token }).eq('id', userId);
  } catch {
    // Non-fatal.
  }
}

/** Fire an immediate local notification from the device itself. */
export async function sendLocalNotification(title: string, body: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null, // immediate
    });
  } catch {
    // Non-fatal — never let a notification failure break the flow.
  }
}
