import React, { useState, useEffect } from 'react';
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

  useEffect(() => {
    const unsub = printerService.subscribe((newState) => {
      setState({ ...newState });
    });
    return unsub;
  }, []);

  // Handle Scan
  const handleStartScan = async () => {
    setDevices([]);
    const ok = await printerService.startScan((device) => {
      setDevices((prev) => {
        if (prev.some((d) => d.address === device.address)) return prev;
        const next = [...prev, device];
        return next.sort((a, b) => (b.isMatching ? 1 : 0) - (a.isMatching ? 1 : 0));
      });
    }, 15000);

    if (!ok && Platform.OS !== 'android') {
      Alert.alert('Notice', 'Thermal printing via Bluetooth is supported on Android physical devices.');
    }
  };

  const handleStopScan = () => {
    printerService.stopScan();
  };

  // Handle Connect
  const handleConnect = async (device: BlePrinterDevice) => {
    try {
      setConnectingAddress(device.address);
      await printerService.connect(device);
      Alert.alert('Connected', `Successfully connected to ${device.name || 'Thermal Printer'}.`);
    } catch (err: any) {
      Alert.alert('Connection Failed', err?.message || 'Could not connect to printer. Please retry.');
    } finally {
      setConnectingAddress(null);
    }
  };

  // Handle Disconnect
  const handleDisconnect = () => {
    printerService.disconnect();
  };

  // Feed Paper
  const handleFeedPaper = () => {
    const ok = printerService.feedPaper();
    if (!ok) {
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
        Alert.alert('Test Print Sent', 'Check your printer output.');
      } else {
        Alert.alert('Print Notice', 'Print command sent.');
      }
    } catch (err: any) {
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
        {/* Status Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.statusIconWrap, isConnected ? styles.statusIconConnected : styles.statusIconDisconnected]}>
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
                <Text style={[styles.densityChipText, density === opt.value && styles.densityChipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Scan & Device Discovery Section */}
        <View style={styles.card}>
          <View style={styles.scanHeaderRow}>
            <View>
              <Text style={styles.cardSectionTitle}>Nearby Bluetooth Printers</Text>
              <Text style={styles.cardSectionDesc}>
                {state.isScanning ? 'Scanning for nearby devices…' : 'Tap scan to search for your printer'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.scanBtn, state.isScanning && styles.scanBtnActive]}
              onPress={state.isScanning ? handleStopScan : handleStartScan}
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
                Make sure your thermal printer is turned ON and Bluetooth is enabled on your phone.
              </Text>
            </View>
          ) : (
            <View style={styles.deviceList}>
              {devices.map((dev) => {
                const isThisConnected = state.connectedDevice?.address === dev.address;
                const isConnectingThis = connectingAddress === dev.address;

                return (
                  <View key={dev.address} style={styles.deviceRow}>
                    <View style={styles.deviceInfoWrap}>
                      <View style={styles.deviceNameRow}>
                        <Text style={styles.deviceName}>{dev.name || 'Unnamed Device'}</Text>
                        {dev.isMatching && (
                          <View style={styles.matchPill}>
                            <Text style={styles.matchPillText}>Thermal</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.deviceAddress}>{dev.address}</Text>
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.deviceActionBtn,
                        isThisConnected && styles.deviceActionBtnConnected,
                      ]}
                      onPress={() => (isThisConnected ? handleDisconnect() : handleConnect(dev))}
                      disabled={isConnectingThis}
                    >
                      {isConnectingThis ? (
                        <ActivityIndicator size="small" color="#2563EB" />
                      ) : isThisConnected ? (
                        <Text style={styles.deviceActionBtnConnectedText}>Connected</Text>
                      ) : (
                        <Text style={styles.deviceActionBtnText}>Connect</Text>
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
            <Text style={styles.helpText}>1. Power on the thermal printer by holding its power button for 3 seconds.</Text>
            <Text style={styles.helpText}>2. Verify that 58mm thermal paper is loaded with the paper facing out.</Text>
            <Text style={styles.helpText}>3. Tap &quot;Scan&quot; above and select your device (e.g. X5h-2152, Cat Printer).</Text>
            <Text style={styles.helpText}>4. Once connected, receipts will print automatically when you select &quot;Print Receipt&quot;!</Text>
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  deviceInfoWrap: {
    flex: 1,
  },
  deviceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deviceName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  matchPill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  matchPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#16A34A',
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
  deviceActionBtnConnected: {
    backgroundColor: '#DCFCE7',
    borderColor: '#BBF7D0',
  },
  deviceActionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB',
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
