import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const DEVICE_ID_KEY = 'sepay_unique_device_id';
let cachedDeviceId: string | null = null;
let cachedDeviceModel: string | null = null;
let cachedOsVersion: string | null = null;

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

  /**
   * Retrieves the physical device hardware model (e.g. "Samsung SM-S918B", "Google Pixel 8", "iPhone 15")
   */
  getDeviceModel: (): string => {
    if (cachedDeviceModel) {
      return cachedDeviceModel;
    }

    try {
      if (Platform.OS === 'android') {
        const constants = (Platform.constants || {}) as any;
        const brand = (constants.Brand || '').trim();
        const manufacturer = (constants.Manufacturer || '').trim();
        const model = (constants.Model || Constants.deviceName || 'Android').trim();

        const mfg = manufacturer || brand;
        if (mfg && !model.toLowerCase().includes(mfg.toLowerCase())) {
          cachedDeviceModel = `${mfg.charAt(0).toUpperCase() + mfg.slice(1)} ${model}`.trim();
        } else {
          cachedDeviceModel = model;
        }
      } else if (Platform.OS === 'ios') {
        cachedDeviceModel = Constants.deviceName || 'iPhone';
      } else {
        cachedDeviceModel = Platform.OS;
      }
    } catch {
      cachedDeviceModel = Platform.OS === 'android' ? 'Android Device' : 'iOS Device';
    }

    return cachedDeviceModel || 'Mobile Device';
  },

  /**
   * Retrieves the operating system release version (e.g. "14", "15", "17.4")
   */
  getOsVersion: (): string => {
    if (cachedOsVersion) {
      return cachedOsVersion;
    }

    try {
      if (Platform.OS === 'android') {
        const constants = (Platform.constants || {}) as any;
        cachedOsVersion = String(constants.Release || Platform.Version || '');
      } else if (Platform.OS === 'ios') {
        const constants = (Platform.constants || {}) as any;
        cachedOsVersion = String(constants.osVersion || Platform.Version || '');
      } else {
        cachedOsVersion = String(Platform.Version || '');
      }
    } catch {
      cachedOsVersion = String(Platform.Version || '');
    }

    return cachedOsVersion || '1.0';
  },
};

export default deviceService;
