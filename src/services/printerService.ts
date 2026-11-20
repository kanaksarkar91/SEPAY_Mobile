import { Platform, PermissionsAndroid, Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  TinyPrinter,
  DeviceDiscoveredEvent,
  ConnectionChangeEvent,
  PrintStatusEvent,
  PrinterStatusEvent,
  Subscription,
} from '../../modules/tiny-printer';

export interface BlePrinterDevice {
  name: string;
  address: string;
  isMatching?: boolean;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'failed' | 'timeout';

export interface PrinterServiceState {
  isAvailable: boolean;
  isBleEnabled: boolean;
  isScanning: boolean;
  connectionStatus: ConnectionStatus;
  connectedDevice: BlePrinterDevice | null;
  savedDevice: BlePrinterDevice | null;
  isPrinting: boolean;
  printProgress: number;
  batteryLevel: number | null; // e.g. 0, 20, 40, 60, 80, 100 or null if unknown
  hasPaper: boolean | null; // true = OK, false = out of paper, null = unknown
  printerStatus: number | null; // vendor status code: 0=normal, 1=out of paper, etc.
}

const SAVED_PRINTER_KEY = 'sepay_saved_printer';
const SAVED_DENSITY_KEY = 'sepay_printer_density';

class PrinterService {
  private state: PrinterServiceState = {
    isAvailable: false,
    isBleEnabled: false,
    isScanning: false,
    connectionStatus: 'disconnected',
    connectedDevice: null,
    savedDevice: null,
    isPrinting: false,
    printProgress: 0,
    batteryLevel: null,
    hasPaper: null,
    printerStatus: null,
  };

  private listeners: Set<(state: PrinterServiceState) => void> = new Set();
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private sdkInitialized = false;
  private savedDensity = 5; // Default to 5 (Darkest / highest thermal contrast)

  private connSub: Subscription | null = null;
  private printSub: Subscription | null = null;
  private scanSub: Subscription | null = null;
  private statusSub: Subscription | null = null;

  constructor() {
    this.checkAvailability();
    this.loadSavedDevice();
    this.loadSavedDensity();
  }

  private updateState(partial: Partial<PrinterServiceState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => {
      try {
        listener(this.state);
      } catch (err) {
        console.warn('[PrinterService] Listener error:', err);
      }
    });
  }

  public getState(): PrinterServiceState {
    this.state.isAvailable = this.isAvailable();
    if (this.state.isAvailable) {
      try {
        this.state.isBleEnabled = TinyPrinter.isBleEnabled();
      } catch {}
    }
    return this.state;
  }

  public subscribe(listener: (state: PrinterServiceState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public isAvailable(): boolean {
    return Platform.OS === 'android' && TinyPrinter.isAvailable();
  }

  private checkAvailability() {
    const available = this.isAvailable();
    this.updateState({ isAvailable: available });
    if (available) {
      this.initSdk();
      this.setupSubscriptions();
    }
  }

  public async initSdk(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    if (this.sdkInitialized) return true;

    try {
      const res = await TinyPrinter.initSdk('QDX');
      this.sdkInitialized = res.success;
      return res.success;
    } catch (e) {
      console.warn('[PrinterService] Failed to init SDK:', e);
      return false;
    }
  }

  private setupSubscriptions() {
    if (this.connSub) this.connSub.remove();
    if (this.printSub) this.printSub.remove();
    if (this.statusSub) this.statusSub.remove();

    this.connSub = TinyPrinter.addConnectionChangeListener((event: ConnectionChangeEvent) => {
      if (event.status === 'connected') {
        const device: BlePrinterDevice = {
          name: event.name || this.state.savedDevice?.name || 'Thermal Printer',
          address: event.address,
          isMatching: true,
        };
        this.updateState({
          connectionStatus: 'connected',
          connectedDevice: device,
        });
        // Request immediate battery & paper state
        try {
          TinyPrinter.requestDeviceStatus(device.name);
        } catch {}
      } else if (event.status === 'disconnected') {
        this.updateState({
          connectionStatus: 'disconnected',
          connectedDevice: null,
          batteryLevel: null,
          hasPaper: null,
          printerStatus: null,
        });
      } else if (event.status === 'failed' || event.status === 'timeout') {
        this.updateState({
          connectionStatus: event.status,
          connectedDevice: null,
          batteryLevel: null,
          hasPaper: null,
          printerStatus: null,
        });
      }
    });

    this.printSub = TinyPrinter.addPrintStatusListener((event: PrintStatusEvent) => {
      if (event.status === 'progress' && event.progress !== undefined) {
        this.updateState({
          isPrinting: true,
          printProgress: event.progress,
        });
      } else if (event.status === 'success') {
        this.updateState({
          isPrinting: false,
          printProgress: 1.0,
        });
        // Refresh battery status after printing
        this.refreshPrinterStatus();
      } else if (event.status === 'failed') {
        this.updateState({
          isPrinting: false,
          printProgress: 0,
        });
      }
    });

    this.statusSub = TinyPrinter.addPrinterStatusListener((event: PrinterStatusEvent) => {
      this.updateState({
        batteryLevel: event.batteryLevel >= 0 ? event.batteryLevel : null,
        hasPaper: event.status >= 0 ? event.hasPaper : null,
        printerStatus: event.status >= 0 ? event.status : null,
      });
    });
  }

  public async loadSavedDevice(): Promise<BlePrinterDevice | null> {
    try {
      const raw = await SecureStore.getItemAsync(SAVED_PRINTER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as BlePrinterDevice;
        this.updateState({ savedDevice: parsed });
        return parsed;
      }
    } catch (e) {
      console.warn('[PrinterService] Error reading saved printer:', e);
    }
    return null;
  }

  public async loadSavedDensity(): Promise<number> {
    try {
      const raw = await SecureStore.getItemAsync(SAVED_DENSITY_KEY);
      if (raw) {
        const val = parseInt(raw, 10);
        if ([2, 3, 5].includes(val)) {
          this.savedDensity = val;
          return val;
        }
      }
    } catch (e) {
      console.warn('[PrinterService] Error reading saved density:', e);
    }
    return this.savedDensity;
  }

  public async getSavedDensity(): Promise<number> {
    return this.loadSavedDensity();
  }

  public async setDensity(density: number): Promise<void> {
    this.savedDensity = density;
    try {
      await SecureStore.setItemAsync(SAVED_DENSITY_KEY, density.toString());
    } catch (e) {
      console.warn('[PrinterService] Error saving density:', e);
    }
  }

  public async saveDevice(device: BlePrinterDevice | null): Promise<void> {
    try {
      if (device) {
        await SecureStore.setItemAsync(SAVED_PRINTER_KEY, JSON.stringify(device));
      } else {
        await SecureStore.deleteItemAsync(SAVED_PRINTER_KEY);
      }
      this.updateState({ savedDevice: device });
    } catch (e) {
      console.warn('[PrinterService] Error saving printer:', e);
    }
  }

  public async checkPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;

    try {
      const apiLevel = Number(Platform.Version);
      if (apiLevel >= 31) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        const scanOk = granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED;
        const connectOk = granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;

        if (!scanOk || !connectOk) {
          Alert.alert(
            'Permissions Required',
            'Nearby Devices (Bluetooth) permission is required to scan and connect to thermal printers. Please allow permissions in Settings.'
          );
          return false;
        }
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location Permission Needed',
            message: 'Android requires Location access to discover nearby Bluetooth devices.',
            buttonPositive: 'Allow',
          }
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          return false;
        }
      }

      const btEnabled = TinyPrinter.isBleEnabled();
      this.updateState({ isBleEnabled: btEnabled });
      if (!btEnabled) {
        Alert.alert(
          'Bluetooth is Turned Off',
          'Please turn ON Bluetooth to search for and connect to thermal printers.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Turn On Bluetooth',
              onPress: () => {
                TinyPrinter.enableBluetooth();
              },
            },
          ]
        );
        return false;
      }

      return true;
    } catch (e) {
      console.warn('[PrinterService] Permission check error:', e);
      return false;
    }
  }

  public async startScan(
    onDeviceFound: (device: BlePrinterDevice) => void,
    timeoutMs: number = 12000
  ): Promise<boolean> {
    if (!this.isAvailable()) return false;

    const ok = await this.checkPermissions();
    if (!ok) return false;

    await this.initSdk();

    this.stopScan();

    if (this.scanSub) this.scanSub.remove();
    this.scanSub = TinyPrinter.addDeviceDiscoveredListener((event: DeviceDiscoveredEvent) => {
      onDeviceFound(event);
    });

    const started = await TinyPrinter.startScan();
    if (started) {
      this.updateState({ isScanning: true });
      this.scanTimer = setTimeout(() => {
        this.stopScan();
      }, timeoutMs);
    }
    return started;
  }

  public stopScan() {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.scanSub) {
      this.scanSub.remove();
      this.scanSub = null;
    }
    if (this.isAvailable()) {
      TinyPrinter.stopScan();
    }
    this.updateState({ isScanning: false });
  }

  public async connect(device: BlePrinterDevice): Promise<boolean> {
    if (!this.isAvailable()) throw new Error('Thermal printer is only supported on Android devices');

    this.stopScan();
    this.updateState({ connectionStatus: 'connecting' });

    try {
      await TinyPrinter.connect(device.address, device.name);
      await this.saveDevice(device);
      this.updateState({
        connectionStatus: 'connected',
        connectedDevice: device,
      });
      return true;
    } catch (err: any) {
      this.updateState({
        connectionStatus: 'failed',
        connectedDevice: null,
      });
      throw err;
    }
  }

  public disconnect(): boolean {
    if (!this.isAvailable()) return false;
    const target = this.state.connectedDevice?.address || this.state.savedDevice?.address;
    if (target) {
      TinyPrinter.disconnect(target);
    }
    this.updateState({
      connectionStatus: 'disconnected',
      connectedDevice: null,
      batteryLevel: null,
      hasPaper: null,
      printerStatus: null,
    });
    return true;
  }

  public getBatteryLevel(): number | null {
    if (this.state.batteryLevel !== null) return this.state.batteryLevel;
    if (this.isAvailable()) {
      const lvl = TinyPrinter.getBatteryLevel();
      if (lvl >= 0) {
        this.updateState({ batteryLevel: lvl });
        return lvl;
      }
    }
    return null;
  }

  public refreshPrinterStatus(): void {
    if (!this.isAvailable()) return;
    const dev = this.state.connectedDevice;
    if (dev) {
      TinyPrinter.requestDeviceStatus(dev.name);
    }
  }

  public feedPaper(): boolean {
    if (!this.isAvailable()) return false;
    return TinyPrinter.feedPaper();
  }

  public openLocationSettings(): boolean {
    if (!this.isAvailable()) return false;
    return TinyPrinter.openLocationSettings();
  }

  public enableBluetooth(): boolean {
    if (!this.isAvailable()) return false;
    return TinyPrinter.enableBluetooth();
  }

  public async autoConnect(): Promise<boolean> {
    if (this.state.connectedDevice && this.state.connectionStatus === 'connected') {
      return true;
    }

    const saved = this.state.savedDevice || (await this.loadSavedDevice());
    if (!saved) return false;

    try {
      const ok = await this.checkPermissions();
      if (!ok) return false;

      await this.initSdk();
      return await this.connect(saved);
    } catch (e) {
      console.warn('[PrinterService] Auto-connect to saved printer failed:', e);
      return false;
    }
  }

  /**
   * Print receipt from Base64 image
   */
  public async printReceiptImage(
    base64Data: string,
    density?: number
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.isAvailable()) {
      return { success: false, error: 'Thermal printing is only supported on Android physical devices.' };
    }

    await this.initSdk();

    let target = this.state.connectedDevice;
    if (!target) {
      const autoOk = await this.autoConnect();
      if (autoOk) {
        target = this.state.connectedDevice;
      }
    }

    if (!target) {
      return {
        success: false,
        error: 'No thermal printer connected. Please connect your printer in Printer Settings.',
      };
    }

    const targetDensity = density ?? (await this.getSavedDensity());
    this.updateState({ isPrinting: true, printProgress: 0 });

    try {
      const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
      const res = await TinyPrinter.printImageBase64(cleanBase64, target.address, target.name, targetDensity);
      this.updateState({ isPrinting: false, printProgress: 1.0 });
      return { success: res.success };
    } catch (err: any) {
      this.updateState({ isPrinting: false, printProgress: 0 });
      return {
        success: false,
        error: err?.message || 'Print job failed. Please check printer power and paper.',
      };
    }
  }
}

export const printerService = new PrinterService();
export default printerService;
