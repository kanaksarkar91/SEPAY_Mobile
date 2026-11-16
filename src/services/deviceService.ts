import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const DEVICE_ID_KEY = 'sepay_unique_device_id';
let cachedDeviceId: string | null = null;

/**
 * Standard RFC4122 v4 UUID generator (fallback-safe across all React Native / Hermes engines)
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID().toUpperCase();
    } catch {
      // Fall through to manual generation
    }
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16).toUpperCase();
  });
}

export const deviceService = {
  /**
   * Returns a persistent, unique device UUID for this physical device.
   * Stored in hardware-backed SecureStore, surviving app updates, logins, and logouts.
   */
  getDeviceId: async (): Promise<string> => {
    if (cachedDeviceId) {
      return cachedDeviceId;
    }

    try {
      const stored = await SecureStore.getItemAsync(DEVICE_ID_KEY);
      if (stored && stored.trim().length > 10) {
        cachedDeviceId = stored.trim();
        return cachedDeviceId;
      }
    } catch (err) {
      console.warn('⚠️ [deviceService] Failed to read deviceId from SecureStore:', err);
    }

    // Generate unique UUID for this physical device
    const newId = generateUUID();
    cachedDeviceId = newId;

    try {
      await SecureStore.setItemAsync(DEVICE_ID_KEY, newId);
    } catch (err) {
      console.warn('⚠️ [deviceService] Failed to persist deviceId to SecureStore:', err);
    }

    return newId;
  },

  /**
   * Synchronous getter for deviceId (returns cached value or fresh fallback UUID)
   */
  getSyncDeviceId: (): string => {
    return cachedDeviceId || generateUUID();
  },

  /**
   * Current operating system platform ('android' | 'ios')
   */
  getPlatform: (): string => {
    return Platform.OS;
  },
};

export default deviceService;
