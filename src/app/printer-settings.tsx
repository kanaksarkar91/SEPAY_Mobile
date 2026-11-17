import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  printerService,
  BlePrinterDevice,
  PrinterServiceState,
} from '../services/printerService';
import { TinyPrinter } from '../../modules/tiny-printer';

export default function PrinterSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [state, setState] = useState<PrinterServiceState>(printerService.getState());
  const [devices, setDevices] = useState<BlePrinterDevice[]>([]);
  const [density, setDensity] = useState<number>(3);
  const [isTestPrinting, setIsTestPrinting] = useState<boolean>(false);
  const [connectingAddress, setConnectingAddress] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsub = printerService.subscribe((newState) => {
      setState({ ...newState });
    });
    return unsub;
  }, []);

  // Handle Scan
  const handleStartScan = useCallback(async (showPromptOnError: boolean = true) => {
    if (Platform.OS !== 'android') {
      if (showPromptOnError) {
        Alert.alert('Notice', 'Thermal printing via Bluetooth is supported on Android physical devices.');
      }
      return;
    }

    if (!printerService.isAvailable()) {
      if (showPromptOnError) {
        Alert.alert(
          'Driver Notice',
          'TinyPrinter native Bluetooth module is not linked in this build. A standalone release APK (assembleRelease) is required to access Bluetooth thermal printers.'
        );
      }
      setStatusMessage('TinyPrinter native driver is not loaded in this build.');
      return;
    }

    setStatusMessage('Scanning for nearby thermal printers…');
    setDevices([]);

    try {
      const ok = await printerService.startScan((device) => {
        setDevices((prev) => {
          if (prev.some((d) => d.address === device.address)) return prev;
          const next = [...prev, device];
          return next.sort((a, b) => (b.isMatching ? 1 : 0) - (a.isMatching ? 1 : 0));
        });
        if (device.isMatching) {
          setStatusMessage(`Found ${device.name || 'thermal printer'} (Recommended)!`);
        }
      }, 15000);

      if (!ok) {
        setStatusMessage('Bluetooth scan could not start. Please ensure Bluetooth is ON.');
      }
    } catch {
      if (showPromptOnError) {
        Alert.alert(
          'Bluetooth Scan',
          'Could not scan. Please ensure Bluetooth and Location (GPS) are turned ON in phone settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => printerService.openLocationSettings() },
          ]
        );
      }
      setStatusMessage('Scan interrupted. Check Bluetooth & Location settings.');
    }
  }, []);

  // Auto-scan on mount if available
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (Platform.OS === 'android' && printerService.isAvailable()) {
      timer = setTimeout(() => {
        handleStartScan(false);
      }, 200);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [handleStartScan]);

  const handleStopScan = () => {
    printerService.stopScan();
    setStatusMessage('Scan stopped');
  };

  // Handle Connect
  const handleConnect = async (device: BlePrinterDevice) => {
    try {
      setConnectingAddress(device.address);
      setStatusMessage(`Connecting to ${device.name || 'Thermal Printer'}…`);
      await printerService.connect(device);
      setStatusMessage(`Connected to ${device.name || 'Thermal Printer'}! 🎉`);
      Alert.alert('Connected', `Successfully connected to ${device.name || 'Thermal Printer'}.`);
    } catch (err: any) {
      setStatusMessage('Connection failed. Please retry.');
      Alert.alert('Connection Failed', err?.message || 'Could not connect to printer. Please retry.');
    } finally {
      setConnectingAddress(null);
    }
  };

  // Handle Disconnect
  const handleDisconnect = () => {
    printerService.disconnect();
    setStatusMessage('Printer disconnected');
  };

  // Feed Paper
  const handleFeedPaper = () => {
    const ok = printerService.feedPaper();
    if (ok) {
      setStatusMessage('Paper fed successfully');
    } else {
      Alert.alert('Notice', 'Please connect to a printer first.');
    }
  };

  // Test Print
  const handleTestPrint = async () => {
    if (!state.connectedDevice) {
      Alert.alert('Not Connected', 'Please connect to your printer before test printing.');
      return;
    }

    try {
      setIsTestPrinting(true);
      setStatusMessage('Sending test receipt to printer…');
      // Generate a structured receipt test via TinyPrinter
      const res = await TinyPrinter.printReceipt(
        {
          storeName: 'SE PAY RECEIPT PRINTER',
          subtitle: 'DIAGNOSTIC TEST PRINT',
          txnId: '#TEST-' + Math.floor(1000 + Math.random() * 9000),
          amount: '$1.00',
          tip: '$0.00',
          total: '$1.00',
          cardType: 'Test Payment',
          cardLast4: '0000',
          status: 'SUCCESS',
          authCode: 'AUTH: OK-200',
        },
        state.connectedDevice.address,
        state.connectedDevice.name,
        density
      );

      if (res.success) {
        setStatusMessage('Test receipt printed successfully! 🎉');
        Alert.alert('Test Print Sent', 'Check your printer output.');
      } else {
        setStatusMessage('Test print command completed.');
        Alert.alert('Print Notice', 'Print command sent.');
      }
    } catch (err: any) {
      setStatusMessage('Test print failed.');
      Alert.alert('Test Print Failed', err?.message || 'Failed to print test receipt.');
    } finally {
      setIsTestPrinting(false);
    }
  };

  const isConnected = state.connectionStatus === 'connected' && !!state.connectedDevice;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="arrow-left" size={22} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Bluetooth Printer</Text>
          <Text style={styles.headerSubtitle}>58mm Thermal Receipt Printer Setup</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Warning card when native module is missing */}
        {!state.isAvailable && Platform.OS === 'android' && (
          <View style={styles.warningCard}>
            <Feather name="alert-triangle" size={18} color="#D97706" style={{ marginRight: 10, marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.warningCardTitle}>Native Driver Not Loaded</Text>
              <Text style={styles.warningCardText}>
                TinyPrinter native Bluetooth driver is not linked in this build. Please run the standalone release APK (assembleRelease) for Bluetooth thermal printing.
              </Text>
            </View>
          </View>
        )}

        {/* Status Message Banner */}
        {statusMessage && (
          <View style={styles.statusBanner}>
            {state.isScanning && (
              <ActivityIndicator size="small" color="#B45309" style={{ marginRight: 8 }} />
            )}
            <Text style={styles.statusBannerText}>{statusMessage}</Text>
          </View>
        )}

        {/* Status Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View
              style={[
                styles.statusIconWrap,
                isConnected ? styles.statusIconConnected : styles.statusIconDisconnected,
              ]}
            >
              <MaterialCommunityIcons
                name={isConnected ? 'printer-check' : 'printer-off'}
                size={24}
                color={isConnected ? '#16A34A' : '#64748B'}
              />
            </View>
            <View style={styles.statusTextWrap}>
              <Text style={styles.statusTitle}>
                {isConnected ? 'Printer Connected' : 'No Printer Connected'}
              </Text>
              <Text style={styles.statusSubtitle}>
                {isConnected
                  ? `${state.connectedDevice?.name} (${state.connectedDevice?.address})`
                  : state.savedDevice
                  ? `Saved: ${state.savedDevice.name} (${state.savedDevice.address})`
                  : 'Search and connect your Bluetooth printer below'}
              </Text>
            </View>
          </View>

          {/* Action Row */}
          {isConnected ? (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.smallBtn, styles.disconnectBtn]}
                onPress={handleDisconnect}
              >
                <Feather name="bluetooth" size={14} color="#DC2626" style={{ marginRight: 6 }} />
                <Text style={styles.disconnectBtnText}>Disconnect</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smallBtn, styles.feedBtn]}
                onPress={handleFeedPaper}
              >
                <Feather name="chevrons-down" size={14} color="#0F172A" style={{ marginRight: 6 }} />
                <Text style={styles.feedBtnText}>Feed Paper</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smallBtn, styles.testBtn]}
                onPress={handleTestPrint}
                disabled={isTestPrinting}
              >
                {isTestPrinting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Feather name="printer" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.testBtnText}>Test Print</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : state.savedDevice ? (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.smallBtn, styles.connectSavedBtn]}
                onPress={() => handleConnect(state.savedDevice!)}
                disabled={connectingAddress === state.savedDevice.address}
              >
                {connectingAddress === state.savedDevice.address ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Feather name="link" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.connectSavedBtnText}>Reconnect Saved Printer</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {/* Print Density Setting */}
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>Print Darkness / Density</Text>
          <Text style={styles.cardSectionDesc}>
            Adjust thermal burn darkness depending on your receipt paper quality.
          </Text>
          <View style={styles.densitySelectorRow}>
            {[
              { label: 'Light', value: 2 },
              { label: 'Normal (Default)', value: 3 },
              { label: 'Dark', value: 5 },
            ].map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.densityChip, density === opt.value && styles.densityChipActive]}
                onPress={() => setDensity(opt.value)}
              >
                <Text
                  style={[
                    styles.densityChipText,
                    density === opt.value && styles.densityChipTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Scan & Device Discovery Section */}
        <View style={styles.card}>
          <View style={styles.scanHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardSectionTitle}>Nearby Bluetooth Printers</Text>
              <Text style={styles.cardSectionDesc}>
                {state.isScanning ? 'Scanning for nearby devices…' : 'Tap Scan to search for your printer'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.scanBtn, state.isScanning && styles.scanBtnActive]}
              onPress={state.isScanning ? handleStopScan : () => handleStartScan(true)}
            >
              {state.isScanning ? (
                <>
                  <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.scanBtnText}>Stop</Text>
                </>
              ) : (
                <>
                  <Feather name="search" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.scanBtnText}>Scan</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Device List */}
          {devices.length === 0 ? (
            <View style={styles.emptyDeviceWrap}>
              <Feather name="bluetooth" size={32} color="#CBD5E1" style={{ marginBottom: 8 }} />
              <Text style={styles.emptyDeviceTitle}>
                {state.isScanning ? 'Searching for devices…' : 'No printers discovered yet'}
              </Text>
              <Text style={styles.emptyDeviceSubtitle}>
                Make sure your thermal printer is turned ON and Bluetooth & Location (GPS) are enabled on your phone.
              </Text>
            </View>
          ) : (
            <View style={styles.deviceList}>
              {devices.map((dev) => {
                const isThisConnected = state.connectedDevice?.address === dev.address;
                const isConnectingThis = connectingAddress === dev.address;

                return (
                  <View
                    key={dev.address}
                    style={[
                      styles.deviceRow,
                      dev.isMatching && styles.deviceRowMatching,
                      isThisConnected && styles.deviceRowConnected,
                    ]}
                  >
                    <View style={styles.deviceInfoWrap}>
                      <View style={styles.deviceNameRow}>
                        <Text style={[styles.deviceName, dev.isMatching && styles.deviceNameMatching]}>
                          {dev.name || 'Unnamed Device'}
                        </Text>
                        {dev.isMatching && (
                          <View style={styles.matchPill}>
                            <Text style={styles.matchPillText}>RECOMMENDED</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.deviceAddress}>{dev.address}</Text>
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.deviceActionBtn,
                        dev.isMatching && styles.deviceActionBtnMatching,
                        isThisConnected && styles.deviceActionBtnConnected,
                      ]}
                      onPress={() => (isThisConnected ? handleDisconnect() : handleConnect(dev))}
                      disabled={isConnectingThis}
                    >
                      {isConnectingThis ? (
                        <ActivityIndicator size="small" color={dev.isMatching ? '#B45309' : '#2563EB'} />
                      ) : isThisConnected ? (
                        <Text style={styles.deviceActionBtnConnectedText}>Connected</Text>
                      ) : (
                        <Text
                          style={[
                            styles.deviceActionBtnText,
                            dev.isMatching && styles.deviceActionBtnMatchingText,
                          ]}
                        >
                          Connect
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Instructions & Help */}
        <View style={styles.helpCard}>
          <Ionicons name="information-circle-outline" size={20} color="#2563EB" style={{ marginRight: 10, marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.helpTitle}>How to connect your printer:</Text>
            <Text style={styles.helpText}>1. Power ON the thermal printer by holding the power button for 3 seconds.</Text>
            <Text style={styles.helpText}>2. Verify that 58mm thermal paper is loaded with the printable face forward.</Text>
            <Text style={styles.helpText}>3. Ensure phone Bluetooth & Location (GPS) are turned ON.</Text>
            <Text style={styles.helpText}>4. Tap &quot;Scan&quot; above and select your device (e.g. X5h-2152, Cat Printer).</Text>
            <Text style={styles.helpText}>5. Once connected, receipts will print automatically when you select &quot;Print Receipt&quot;!</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: {
    padding: 6,
    marginRight: 12,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  warningCard: {
    flexDirection: 'row',
    backgroundColor: '#FEF3C7',
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  warningCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 2,
  },
  warningCardText: {
    fontSize: 11.5,
    color: '#B45309',
    lineHeight: 16,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  statusBannerText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#1E40AF',
    flex: 1,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  statusIconConnected: {
    backgroundColor: '#DCFCE7',
  },
  statusIconDisconnected: {
    backgroundColor: '#F1F5F9',
  },
  statusTextWrap: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  statusSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  smallBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  disconnectBtn: {
    backgroundColor: '#FEE2E2',
  },
  disconnectBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DC2626',
  },
  feedBtn: {
    backgroundColor: '#F1F5F9',
  },
  feedBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },
  testBtn: {
    backgroundColor: '#0F172A',
  },
  testBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  connectSavedBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
  },
  connectSavedBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cardSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  cardSectionDesc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    marginBottom: 12,
  },
  densitySelectorRow: {
    flexDirection: 'row',
    gap: 8,
  },
  densityChip: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  densityChipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#2563EB',
  },
  densityChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  densityChipTextActive: {
    color: '#2563EB',
    fontWeight: '700',
  },
  scanHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  scanBtnActive: {
    backgroundColor: '#DC2626',
  },
  scanBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyDeviceWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
  },
  emptyDeviceTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  emptyDeviceSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 20,
  },
  deviceList: {
    marginTop: 8,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  deviceRowMatching: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  deviceRowConnected: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  deviceInfoWrap: {
    flex: 1,
    marginRight: 10,
  },
  deviceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  deviceName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  deviceNameMatching: {
    fontWeight: '700',
    color: '#92400E',
  },
  matchPill: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  matchPillText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#B45309',
  },
  deviceAddress: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  deviceActionBtn: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  deviceActionBtnMatching: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
  },
  deviceActionBtnConnected: {
    backgroundColor: '#DCFCE7',
    borderColor: '#BBF7D0',
  },
  deviceActionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB',
  },
  deviceActionBtnMatchingText: {
    color: '#B45309',
    fontWeight: '700',
  },
  deviceActionBtnConnectedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#16A34A',
  },
  helpCard: {
    flexDirection: 'row',
    backgroundColor: '#EFF6FF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  helpTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E40AF',
    marginBottom: 6,
  },
  helpText: {
    fontSize: 12,
    color: '#1E3A8A',
    lineHeight: 18,
    marginBottom: 2,
  },
});
