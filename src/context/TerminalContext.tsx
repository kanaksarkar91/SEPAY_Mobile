import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { NativeModules, Platform, PermissionsAndroid, type Permission } from 'react-native';
import type { Reader } from '@stripe/stripe-terminal-react-native';
import { config } from '../constants/config';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { appLogger } from '../services/appLogger';
import {
  createPaymentIntentOnBackend,
  getCachedLocationId,
  clearStripeCache,
  fetchTerminalConfig,
  retrievePaymentIntentStatus,
  tokenizeCardWithStripe,
  type CreatePaymentIntentResponse,
} from '../services/stripeApi';
import { useAuth } from './AuthContext';
import type { PaymentMethodType, FeeBreakdown } from '../utils/feeCalculator';

interface TerminalContextValue {
  isInitialized: boolean;
  isConnecting: boolean;
  isProcessing: boolean;
  connectedReader: Reader.Type | null | undefined;
  statusMessage: string;
  errorMessage: string | null;
  initAndConnectSimulatedReader: (forceReconnect?: boolean) => Promise<boolean>;
  runSimulatedPayment: (
    amount: number,
    paymentMethod: PaymentMethodType,
    feeBreakdown?: FeeBreakdown,
    cardInput?: { number: string; expMonth: string; expYear: string; cvc: string },
    routeDetails?: {
      pickup_id?: number | string | null;
      dropoff_id?: number | string | null;
      dropup_id?: number | string | null;
      service_charges?: number | null;
      pickup?: string | null;
      dropoff?: string | null;
      pickup_location?: string | null;
      dropup_location?: string | null;
      shift_session_id?: number | string | null;
    }
  ) => Promise<{ success: boolean; paymentIntent?: any; error?: string }>;
  clearError: () => void;
  resetPaymentState: () => void;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

const hasNativeTerminal = Boolean(NativeModules?.StripeTerminalReactNative);

/**
 * Shared helper to process card payments, handling 3D Secure (OTP / SMS) via in-app browser
 */
async function handleCardPaymentWith3DS(
  intentRes: CreatePaymentIntentResponse,
  setStatusMessage: (msg: string) => void
): Promise<any> {
  // If 3D Secure / Bank OTP authentication is required
  if (intentRes.requiresAction && intentRes.redirectUrl) {
    const redirectUrl = intentRes.redirectUrl;
    console.log('🔐 [3DS] Opening in-app browser for bank OTP authorization:', redirectUrl);
    setStatusMessage('Waiting for Bank OTP verification...');

    const returnUrl = Linking.createURL('payment-return');

    // Run auth session and polling in parallel so verification is caught immediately
    let confirmedPi: any = null;
    let failedReason: string | null = null;
    let isCompleted = false;

    const pollPromise = (async () => {
      let attempts = 0;
      const maxAttempts = 150; // 150 * 2s = 300 seconds (5 minutes timeout)
      while (attempts < maxAttempts && !isCompleted) {
        await new Promise((r) => setTimeout(r, 2000));
        if (isCompleted) break;
        try {
          const check = await retrievePaymentIntentStatus(intentRes.paymentIntentId);
          console.log(`🔍 [3DS Check ${attempts + 1}/${maxAttempts}]: Status = ${check.status}`);

          if (check.status === 'succeeded') {
            confirmedPi = check;
            isCompleted = true;
            try {
              await WebBrowser.dismissBrowser();
            } catch {}
            break;
          }

          if (check.status === 'requires_payment_method') {
            failedReason = 'Bank 3D-Secure authentication was declined or cancelled. The card was not billed.';
            isCompleted = true;
            try {
              await WebBrowser.dismissBrowser();
            } catch {}
            break;
          }
        } catch (err) {
          console.warn('⚠️ Error checking PaymentIntent status:', err);
        }
        attempts++;
      }
    })();

    const browserPromise = (async () => {
      try {
        await WebBrowser.openAuthSessionAsync(
          redirectUrl,
          returnUrl,
          {
            showTitle: true,
            enableBarCollapsing: true,
            preferEphemeralSession: false,
          }
        );
      } catch {
        try {
          await WebBrowser.openBrowserAsync(redirectUrl, {
            showTitle: true,
            enableBarCollapsing: true,
          });
        } catch {}
      }
    })();

    await Promise.race([
      pollPromise,
      (async () => {
        await browserPromise;
        // If user manually closed browser or redirected, wait brief moment for final poll
        await new Promise((r) => setTimeout(r, 2000));
      })(),
    ]);

    isCompleted = true;
    try {
      await WebBrowser.dismissBrowser();
    } catch {}

    // Final status verification
    if (!confirmedPi && !failedReason) {
      try {
        const finalCheck = await retrievePaymentIntentStatus(intentRes.paymentIntentId);
        if (finalCheck.status === 'succeeded') {
          confirmedPi = finalCheck;
        } else if (finalCheck.status === 'requires_payment_method') {
          failedReason = 'Bank 3D-Secure authentication was declined or cancelled.';
        }
      } catch {}
    }

    if (failedReason) {
      throw new Error(failedReason);
    }

    if (!confirmedPi || confirmedPi.status !== 'succeeded') {
      throw new Error(
        'Bank 3D-Secure authentication timed out. If you did not receive the OTP, please retry.'
      );
    }

    return {
      id: confirmedPi.id,
      amount: confirmedPi.amount,
      currency: confirmedPi.currency,
      status: confirmedPi.status,
      charges: confirmedPi.charges?.length ? confirmedPi.charges : [{ id: confirmedPi.id }],
    };
  }

  // Direct charge without 3D Secure
  if (intentRes.status !== 'succeeded') {
    throw new Error(
      `Stripe did not confirm the charge (Status: "${intentRes.status}"). The card was NOT billed. Please verify card details and ensure your backend on Render is updated.`
    );
  }

  return {
    id: intentRes.paymentIntentId,
    amount: intentRes.amount,
    currency: intentRes.currency,
    status: intentRes.status,
    charges: intentRes.charges?.length ? intentRes.charges : [{ id: intentRes.paymentIntentId }],
  };
}

// ─── 1. Simulated Provider (Safe for Expo Go without native binary) ───
const SimulatedTerminalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('Ready');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectedReader, setConnectedReader] = useState<Reader.Type | null>(null);
  const isPaymentInFlightRef = useRef(false);

  const initAndConnectSimulatedReader = useCallback(async (_forceReconnect?: boolean): Promise<boolean> => {
    setIsConnecting(true);
    setStatusMessage('Connecting to simulated reader...');
    await new Promise((r) => setTimeout(r, 600));

    setConnectedReader({
      serialNumber: 'SIM-READER-EXPO-GO',
      label: 'Simulated Tap to Pay Reader',
      deviceType: 'tapToPay',
      simulated: true,
      locationId: getCachedLocationId() || config.locationId || 'loc_simulated',
      status: 'online',
    } as any);

    setStatusMessage('Reader ready');
    setIsConnecting(false);
    return true;
  }, []);

  const runSimulatedPayment = useCallback(
    async (
      amount: number,
      paymentMethod: PaymentMethodType,
      feeBreakdown?: FeeBreakdown,
      cardInput?: { number: string; expMonth: string; expYear: string; cvc: string },
      routeDetails?: {
        pickup_id?: number | string | null;
        dropoff_id?: number | string | null;
        dropup_id?: number | string | null;
        service_charges?: number | null;
        pickup?: string | null;
        dropoff?: string | null;
        pickup_location?: string | null;
        dropup_location?: string | null;
        shift_session_id?: number | string | null;
      }
    ): Promise<{ success: boolean; paymentIntent?: any; error?: string }> => {
      try {
        if (isPaymentInFlightRef.current) {
          appLogger.warn('TERMINAL', 'runSimulatedPayment duplicate blocked (already in flight).');
          return { success: false, error: 'A payment transaction is currently in progress.' };
        }
        isPaymentInFlightRef.current = true;
        setIsProcessing(true);
        setErrorMessage(null);
        setStatusMessage(
          paymentMethod === 'card'
            ? 'Processing card payment...'
            : 'Processing contactless payment...'
        );

        appLogger.info('SIMULATED_TERMINAL', `Starting simulated payment for $${amount}`, {
          paymentMethod,
          isLiveMode: !config.simulatedReader,
          routeDetails,
        });

        if (paymentMethod === 'card') {
          let paymentMethodId: string | undefined;
          let cardBrand = 'Card';
          let cardLast4 = '••••';

          if (cardInput?.number) {
            setStatusMessage('Securing card with Stripe...');
            try {
              const pmResult = await tokenizeCardWithStripe(cardInput);
              paymentMethodId = pmResult.id;
              cardBrand = pmResult.brand;
              cardLast4 = pmResult.last4;
            } catch (tokErr: any) {
              console.warn('⚠️ Client-side tokenization failed, attempting backend fallback:', tokErr.message);
            }
          }

          setStatusMessage('Authorizing card transaction with Stripe...');
          const intentRes = await createPaymentIntentOnBackend(
            amount,
            'aud',
            'card',
            cardInput,
            paymentMethodId,
            routeDetails
          );
          console.log('💳 [STRIPE CARD API RESPONSE]:', JSON.stringify(intentRes, null, 2));

          const confirmedPaymentIntent = await handleCardPaymentWith3DS(intentRes, setStatusMessage);

          setStatusMessage('Payment Successful');
          setIsProcessing(false);
          return {
            success: true,
            paymentIntent: {
              ...confirmedPaymentIntent,
              cardBrand: confirmedPaymentIntent.cardBrand || cardBrand,
              cardLast4: confirmedPaymentIntent.cardLast4 || cardLast4,
            },
          };
        }

        // Tap to Pay Flow
        setStatusMessage('Connecting to reader...');
        await new Promise((r) => setTimeout(r, 600));

        setStatusMessage('Creating PaymentIntent on backend...');
        const intentRes = await createPaymentIntentOnBackend(amount, 'aud', 'tap', undefined, undefined, routeDetails);
        appLogger.info('SIMULATED_TERMINAL', 'Backend createPaymentIntent response:', intentRes);
        console.log('📋 [STRIPE TAP API RESPONSE]:', JSON.stringify(intentRes, null, 2));

        // When running in Live Mode without the native Stripe Terminal binary (e.g. inside Expo Go):
        // Never falsely mark a payment as successful if Stripe has not actually collected and confirmed the funds!
        if (!config.simulatedReader) {
          if (intentRes.status !== 'succeeded') {
            const liveErr = `Payment was NOT completed on Stripe (Status: "${intentRes.status || 'requires_payment_method'}", Received: $0.00). Reading and charging physical cards requires the standalone APK build on an Android phone with NFC enabled. No funds were debited from the card.`;
            appLogger.error('SIMULATED_TERMINAL', liveErr, intentRes);
            throw new Error(liveErr);
          }
        }

        setStatusMessage('Processing contactless tap...');
        await new Promise((r) => setTimeout(r, 1200));

        setStatusMessage('Confirming payment with Stripe...');
        await new Promise((r) => setTimeout(r, 800));

        setStatusMessage('Payment Successful');
        setIsProcessing(false);

        const realTxnId = intentRes.paymentIntentId || (intentRes as any).id || '--';
        return {
          success: true,
          paymentIntent: {
            id: realTxnId,
            paymentIntentId: realTxnId,
            amount: intentRes.amount,
            amountInDollars: intentRes.amountInDollars,
            currency: intentRes.currency || 'aud',
            status: 'succeeded',
            charges: [
              {
                id: intentRes.charges?.[0]?.id || (realTxnId !== '--' ? realTxnId : '--'),
                amount: intentRes.amount,
                paymentMethodDetails: {
                  type: 'card_present',
                  cardPresentDetails: {
                    brand: 'Contactless',
                    last4: '4242',
                  },
                },
              },
            ],
          },
        };
      } catch (err: any) {
        console.error('Payment processing failed:', err);
        const msg = err.message || 'Payment failed';
        appLogger.error('SIMULATED_TERMINAL', `Payment failed: ${msg}`, err);
        setErrorMessage(msg);
        setStatusMessage('Payment Failed');
        return { success: false, error: msg };
      } finally {
        isPaymentInFlightRef.current = false;
        setIsProcessing(false);
      }
    },
    []
  );

  const clearError = () => setErrorMessage(null);

  const resetPaymentState = useCallback(() => {
    isPaymentInFlightRef.current = false;
    setIsProcessing(false);
    setErrorMessage(null);
    setStatusMessage('Processing payment...');
  }, []);

  return (
    <TerminalContext.Provider
      value={{
        isInitialized: true,
        isConnecting,
        isProcessing,
        connectedReader,
        statusMessage,
        errorMessage,
        initAndConnectSimulatedReader,
        runSimulatedPayment,
        clearError,
        resetPaymentState,
      }}
    >
      {children}
    </TerminalContext.Provider>
  );
};

// ─── 2. Native Provider (For Expo Development Build with real SDK) ───
const NativeTerminalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    useStripeTerminal,
    } = require('@stripe/stripe-terminal-react-native');

  const [isConnecting, setIsConnecting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('Ready');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { user, isAuthenticated } = useAuth();
  const currentUserIdRef = useRef<number | string | null>(null);

  const discoveredReadersRef = useRef<Reader.Type[]>([]);
  const lastReaderErrorRef = useRef<string>('');
  const isPaymentInFlightRef = useRef(false);
  const isCollectingRef = useRef(false);
  const permissionsCheckedRef = useRef(false);
  const connectingPromiseRef = useRef<Promise<boolean> | null>(null);

  const {
    initialize,
    discoverReaders,
    cancelDiscovering,
    connectReader,
    disconnectReader,
    connectedReader,
    retrievePaymentIntent,
    collectPaymentMethod,
    confirmPaymentIntent,
    cancelCollectPaymentMethod,
    getConnectionStatus,
    getConnectedReader,
    getPaymentStatus,
    isInitialized,
    supportsReadersOfType,
  } = useStripeTerminal({
    onUpdateDiscoveredReaders: (readers: Reader.Type[]) => {
      appLogger.info('TERMINAL', `📡 onUpdateDiscoveredReaders callback: found ${readers.length} reader(s)`, {
        readers: readers.map((r) => ({
          serialNumber: r.serialNumber,
          deviceType: r.deviceType,
          locationId: r.locationId,
          status: r.status,
        })),
      });
      console.log('📡 Discovered readers:', readers.length);
      discoveredReadersRef.current = readers;
    },
    onDidChangeConnectionStatus: (status: any) => {
      appLogger.info('TERMINAL', `🔄 Terminal connection status changed: ${status}`);
      console.log('🔄 Terminal connection status changed:', status);
    },
    onDidChangePaymentStatus: (status: any) => {
      appLogger.info('TERMINAL', `💳 Payment status changed: ${status}`);
      console.log('💳 Payment status changed:', status);
    },
    onDidDisconnect: (reason: any) => {
      appLogger.warn('TERMINAL', `⚠️ Reader disconnected: ${reason}`);
      console.warn('⚠️ Reader disconnected:', reason);
    },
  });

  // Reset Stripe cache and reader connection if user switches or logs out
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      if (currentUserIdRef.current && currentUserIdRef.current !== user.id) {
        appLogger.info('TERMINAL', `🔄 User switched from ${currentUserIdRef.current} to ${user.id}. Resetting Terminal connection...`);
        clearStripeCache();
        if (typeof disconnectReader === 'function') {
          disconnectReader().catch(() => {});
        }
      }
      currentUserIdRef.current = user.id;
    } else if (!isAuthenticated) {
      currentUserIdRef.current = null;
      clearStripeCache();
      if (typeof disconnectReader === 'function') {
        disconnectReader().catch(() => {});
      }
    }
  }, [isAuthenticated, user?.id, disconnectReader]);

  useEffect(() => {
    async function init() {
      if (!isAuthenticated) {
        appLogger.info('TERMINAL', 'Stripe Terminal initialize deferred: waiting for user authentication.');
        return;
      }
      try {
        appLogger.info('TERMINAL', '⚙️ Initializing Stripe Terminal SDK...');
        console.log('⚙️ Initializing Stripe Terminal SDK...');
        const { error } = await initialize();
        if (error) {
          const initMsg = `SDK Init Error: ${error.message} (Code: ${error.code || 'UNKNOWN'})`;
          appLogger.error('TERMINAL', initMsg, error);
          console.error('Failed to initialize Stripe Terminal:', error);
          setErrorMessage(initMsg);
        } else {
          appLogger.info('TERMINAL', '✅ Stripe Terminal initialized successfully');
          console.log('✅ Stripe Terminal initialized successfully');
        }
      } catch (err: any) {
        appLogger.error('TERMINAL', 'Terminal initialize exception:', err?.message || err);
        console.error('Terminal initialize exception:', err);
      }
    }
    init();
  }, [initialize, isAuthenticated]);

  const safeCancelCollectPaymentMethod = useCallback(async () => {
    if (!isCollectingRef.current) {
      return;
    }
    isCollectingRef.current = false;
    try {
      if (typeof cancelCollectPaymentMethod === 'function') {
        appLogger.info('TERMINAL', 'Safely cancelling active payment method collection with timeout...');
        await Promise.race([
          cancelCollectPaymentMethod(),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
      }
    } catch (err: any) {
      appLogger.warn('TERMINAL', 'safeCancelCollectPaymentMethod warning:', err?.message || err);
    }
  }, [cancelCollectPaymentMethod]);

  const checkIsReaderActuallyConnected = useCallback(async (): Promise<boolean> => {
    try {
      if (typeof getConnectionStatus === 'function') {
        const connStatus = await getConnectionStatus();
        appLogger.info('TERMINAL', `Native getConnectionStatus result: "${connStatus}"`);
        if (connStatus !== 'connected') {
          return false;
        }
      }
      if (typeof getConnectedReader === 'function') {
        const nativeReader = await getConnectedReader();
        appLogger.info('TERMINAL', `Native getConnectedReader result:`, {
          hasReader: Boolean(nativeReader),
          serialNumber: nativeReader?.serialNumber,
          deviceType: nativeReader?.deviceType,
        });
        if (!nativeReader) {
          return false;
        }
      }
      return true;
    } catch (err: any) {
      appLogger.warn('TERMINAL', 'checkIsReaderActuallyConnected caught exception:', err?.message || err);
      return false;
    }
  }, [getConnectionStatus, getConnectedReader]);

  const initAndConnectSimulatedReader = useCallback(
    async (forceReconnect: boolean = false): Promise<boolean> => {
      // If another connection is already in flight and we aren't forcing a fresh reconnect, await existing promise
      if (connectingPromiseRef.current && !forceReconnect) {
        appLogger.info('TERMINAL', 'Reader connection already in flight, awaiting existing operation...');
        return connectingPromiseRef.current;
      }

      const connectionTask = (async (): Promise<boolean> => {
        try {
          // 0. Quick check: if not forcing reconnect and native SDK is ALREADY connected, return immediately!
          if (!forceReconnect) {
            const alreadyConnected = await checkIsReaderActuallyConnected();
            if (alreadyConnected) {
              appLogger.info('TERMINAL', 'Reader is ALREADY verified connected in native SDK (instant bypass)');
              setStatusMessage('Reader ready');
              return true;
            }
          }

          setIsConnecting(true);
          setErrorMessage(null);
          lastReaderErrorRef.current = '';

          appLogger.info('TERMINAL', '=== [START] initAndConnectSimulatedReader ===', {
            platform: Platform.OS,
            osVersion: Platform.Version,
            isSimulated: config.simulatedReader,
            isInitialized,
            forceReconnect,
          });

          // 1. Non-disruptive check: only request Android permissions once per session if missing
          if (Platform.OS === 'android' && !permissionsCheckedRef.current) {
            try {
              const hasFineLoc = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
              const hasCoarseLoc = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);
              const hasAnyLocation = hasFineLoc || hasCoarseLoc;

              const missingPermissions: Permission[] = [];
              if (!hasAnyLocation) {
                missingPermissions.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
                missingPermissions.push(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);
              }

              if (typeof Platform.Version === 'number' && Platform.Version >= 31) {
                if (PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN) {
                  const hasScan = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
                  if (!hasScan) missingPermissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
                }
                if (PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT) {
                  const hasConn = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
                  if (!hasConn) missingPermissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
                }
              }

              if (missingPermissions.length > 0) {
                setStatusMessage('Checking device permissions...');
                appLogger.info('TERMINAL', 'Requesting missing Android permissions:', missingPermissions);
                const permsResult = await PermissionsAndroid.requestMultiple(missingPermissions);
                appLogger.info('TERMINAL', 'PermissionsAndroid.requestMultiple results:', permsResult);
              } else {
                appLogger.info('TERMINAL', 'All needed Android permissions already granted.');
              }
              permissionsCheckedRef.current = true;
            } catch (permEx: any) {
              appLogger.warn('TERMINAL', 'Permission check exception:', permEx?.message || permEx);
              permissionsCheckedRef.current = true;
            }
          }

          setStatusMessage('Initializing reader...');

          if (!isInitialized) {
            appLogger.info('TERMINAL', 'Stripe Terminal SDK not initialized yet. Calling initialize()...');
            const { error: initError } = await initialize();
            if (initError) {
              const initErrText = `SDK Init Failed: ${initError.message} (Code: ${initError.code || 'UNKNOWN'})`;
              appLogger.error('TERMINAL', initErrText, initError);
              throw new Error(initErrText);
            }
            appLogger.info('TERMINAL', 'SDK initialize completed.');
          }

          // If native SDK is in a stale or non-connected state, ensure clean disconnect first
          try {
            if (typeof getConnectionStatus === 'function') {
              const connStatus = await getConnectionStatus();
              if (connStatus && connStatus !== 'notConnected' && typeof disconnectReader === 'function') {
                appLogger.info('TERMINAL', `Disconnecting stale reader state (${connStatus}) before re-discovery...`);
                await disconnectReader();
              }
            }
          } catch (discErr) {
        appLogger.warn('TERMINAL', 'disconnectReader warning before reconnect:', discErr);
      }

      // Check device support for Tap to Pay
      if (typeof supportsReadersOfType === 'function') {
        try {
          const supportRes = await supportsReadersOfType({
            deviceType: 'tapToPay' as any,
            simulated: Boolean(config.simulatedReader),
            discoveryMethod: 'tapToPay' as any,
          });
          appLogger.info('TERMINAL', 'supportsReadersOfType result:', supportRes);
          if (
            supportRes?.error?.code === 'TAP_TO_PAY_UNSUPPORTED_DEVICE' ||
            supportRes?.readerSupportResult === false
          ) {
            const devErr =
              'This phone model does not support Tap to Pay hardware security (Device lacks Trusted Execution Environment / Key Attestation required by Stripe & PCI standards). Please use a supported device (e.g. Samsung Galaxy, Google Pixel).';
            appLogger.error('TERMINAL', devErr, supportRes);
            throw new Error(devErr);
          }
        } catch (supErr: any) {
          if (supErr.message?.includes('Trusted Execution Environment')) {
            throw supErr;
          }
          appLogger.warn('TERMINAL', 'supportsReadersOfType exception:', supErr?.message || supErr);
        }
      }

      try {
        await cancelDiscovering();
        appLogger.info('TERMINAL', 'Previous discovery cancelled cleanly.');
      } catch {
        // ignore
      }

      setStatusMessage(
        config.simulatedReader
          ? 'Discovering simulated reader...'
          : 'Initializing device NFC antenna...'
      );
      appLogger.info('TERMINAL', 'Starting discoverReaders(discoveryMethod: "tapToPay")...', {
        simulated: config.simulatedReader,
      });

      discoveredReadersRef.current = [];
      const { error: discoverError } = await discoverReaders({
        discoveryMethod: 'tapToPay',
        simulated: config.simulatedReader,
      });

      if (discoverError) {
        let discErrText = `Discovery Error: ${discoverError.message} (Code: ${discoverError.code || 'UNKNOWN'}).`;
        if (
          discoverError.code === 'TAP_TO_PAY_UNSUPPORTED_DEVICE' ||
          discoverError.message?.includes('Trusted Execution Environment')
        ) {
          discErrText =
            'This phone model does not support Tap to Pay hardware security (Device lacks Trusted Execution Environment / Key Attestation required by Stripe & PCI standards). Please use a supported device (e.g. Samsung Galaxy, Google Pixel).';
        } else {
          discErrText += ' Please ensure Location (GPS) is turned ON and NFC is enabled in Android settings.';
        }
        appLogger.error('TERMINAL', discErrText, discoverError);
        throw new Error(discErrText);
      }
      appLogger.info('TERMINAL', 'discoverReaders initiated successfully. Polling discoveredReadersRef...');

      let attempts = 0;
      while (discoveredReadersRef.current.length === 0 && attempts < 35) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        attempts++;
      }

      appLogger.info('TERMINAL', `Discovery polling ended after ${attempts * 300}ms. Discovered:`, {
        count: discoveredReadersRef.current.length,
        readers: discoveredReadersRef.current.map((r) => ({
          serialNumber: r.serialNumber,
          deviceType: r.deviceType,
        })),
      });

      const readerToConnect = discoveredReadersRef.current[0];
      if (!readerToConnect) {
        const noReaderText = config.simulatedReader
          ? 'No simulated reader found during discovery.'
          : 'No Tap to Pay reader detected on device after 10s. Please ensure: 1) NFC is turned ON, 2) Location (GPS) is turned ON in phone settings, 3) Google Play Services is active.';
        appLogger.error('TERMINAL', noReaderText);
        throw new Error(noReaderText);
      }

      setStatusMessage(config.simulatedReader ? 'Connecting to reader...' : 'Connecting NFC reader...');
      let locationId = getCachedLocationId() || config.locationId;
      appLogger.info('TERMINAL', 'Resolving location ID for reader connection...', { initialLocationId: locationId });
      if (!locationId || locationId === 'loc_simulated') {
        try {
          const termConfig = await fetchTerminalConfig();
          locationId = termConfig.locationId;
          appLogger.info('TERMINAL', 'Fetched locationId from backend:', locationId);
        } catch (locErr: any) {
          appLogger.error('TERMINAL', 'fetchTerminalConfig failed:', locErr?.message || locErr);
        }
      }
      if (!locationId) {
        locationId = 'loc_simulated';
        appLogger.warn('TERMINAL', 'Location ID fallback to loc_simulated');
      }

      appLogger.info('TERMINAL', 'Connecting to reader with params:', {
        discoveryMethod: 'tapToPay',
        serialNumber: readerToConnect.serialNumber,
        locationId,
      });

      const { reader, error: connectError } = await connectReader({
        discoveryMethod: 'tapToPay',
        reader: readerToConnect,
        locationId,
        merchantDisplayName: 'SE PAY',
        tosAcceptancePermitted: true,
        autoReconnectOnUnexpectedDisconnect: true,
      });

      if (connectError) {
        const connErrText = `Connect Reader Error: ${connectError.message} (Code: ${connectError.code || 'UNKNOWN'}). Location: ${locationId}`;
        appLogger.error('TERMINAL', connErrText, connectError);
        throw new Error(connErrText);
      }

      appLogger.info('TERMINAL', '✅ Connected to Tap to Pay reader successfully:', {
        serialNumber: reader?.serialNumber,
        deviceType: reader?.deviceType,
      });
      console.log('✅ Connected to Tap to Pay reader:', reader?.serialNumber);
      setStatusMessage('Reader ready');
      return true;
    } catch (err: any) {
      const errStr = err?.message || String(err);
      lastReaderErrorRef.current = errStr;
      appLogger.error('TERMINAL', `Reader connection failure: ${errStr}`, {
        stack: err?.stack,
        raw: err,
      });
      console.error('Reader connection failure:', err);
      setErrorMessage(errStr);
      setStatusMessage('Connection failed');
      return false;
    } finally {
      setIsConnecting(false);
      connectingPromiseRef.current = null;
    }
  })();

  connectingPromiseRef.current = connectionTask;
  return connectionTask;
}, [
  isInitialized,
  initialize,
  discoverReaders,
  cancelDiscovering,
  connectReader,
  disconnectReader,
  getConnectionStatus,
  checkIsReaderActuallyConnected,
  supportsReadersOfType,
]);

  const runSimulatedPayment = useCallback(
    async (
      amount: number,
      paymentMethod: PaymentMethodType,
      feeBreakdown?: FeeBreakdown,
      cardInput?: { number: string; expMonth: string; expYear: string; cvc: string },
      routeDetails?: {
        pickup_id?: number | string | null;
        dropoff_id?: number | string | null;
        dropup_id?: number | string | null;
        service_charges?: number | null;
        pickup?: string | null;
        dropoff?: string | null;
        pickup_location?: string | null;
        dropup_location?: string | null;
        shift_session_id?: number | string | null;
      }
    ): Promise<{ success: boolean; paymentIntent?: any; error?: string }> => {
      try {
        if (isPaymentInFlightRef.current) {
          appLogger.warn('TERMINAL', 'runSimulatedPayment duplicate blocked (already in flight).');
          return { success: false, error: 'A payment transaction is currently in progress.' };
        }
        isPaymentInFlightRef.current = true;
        setIsProcessing(true);
        setErrorMessage(null);
        setStatusMessage(
          paymentMethod === 'card'
            ? 'Processing card payment...'
            : 'Processing contactless payment...'
        );

        appLogger.info('TERMINAL', `=== [START] runSimulatedPayment ===`, {
          amount,
          paymentMethod,
          hasCardInput: Boolean(cardInput?.number),
        });

        if (paymentMethod === 'card') {
          let paymentMethodId: string | undefined;
          let cardBrand = 'Card';
          let cardLast4 = '••••';

          if (cardInput?.number) {
            setStatusMessage('Securing card with Stripe...');
            try {
              const pmResult = await tokenizeCardWithStripe(cardInput);
              paymentMethodId = pmResult.id;
              cardBrand = pmResult.brand;
              cardLast4 = pmResult.last4;
              appLogger.info('TERMINAL', 'Client-side card tokenization succeeded:', {
                id: pmResult.id,
                brand: pmResult.brand,
                last4: pmResult.last4,
              });
            } catch (tokErr: any) {
              appLogger.warn('TERMINAL', 'Client-side tokenization failed, attempting backend fallback:', tokErr.message);
              console.warn('⚠️ Client-side tokenization failed, attempting backend fallback:', tokErr.message);
            }
          }

          setStatusMessage('Authorizing card transaction with Stripe...');
          appLogger.info('TERMINAL', 'Calling createPaymentIntentOnBackend for card payment...');
          const intentRes = await createPaymentIntentOnBackend(
            amount,
            'aud',
            'card',
            cardInput,
            paymentMethodId,
            routeDetails
          );
          appLogger.info('TERMINAL', 'Card PaymentIntent created:', intentRes);
          console.log('💳 [STRIPE CARD API RESPONSE]:', JSON.stringify(intentRes, null, 2));

          const confirmedPaymentIntent = await handleCardPaymentWith3DS(intentRes, setStatusMessage);

          appLogger.info('TERMINAL', 'Card payment confirmed successfully:', confirmedPaymentIntent);
          setStatusMessage('Payment Successful');
          setIsProcessing(false);
          return {
            success: true,
            paymentIntent: {
              ...confirmedPaymentIntent,
              cardBrand: confirmedPaymentIntent.cardBrand || cardBrand,
              cardLast4: confirmedPaymentIntent.cardLast4 || cardLast4,
            },
          };
        }

        // Tap to Pay flow with real native SDK
        setStatusMessage(
          config.simulatedReader
            ? 'Checking simulated reader...'
            : 'Checking device NFC reader...'
        );

        // Always verify real native reader connection before starting payment intent collection
        const isReaderReady = await checkIsReaderActuallyConnected();
        if (!isReaderReady) {
          appLogger.info('TERMINAL', 'Reader not verified connected in native SDK, running connect flow...');
          const connected = await initAndConnectSimulatedReader();
          if (!connected) {
            const specificReason = lastReaderErrorRef.current || (
              config.simulatedReader
                ? 'Could not connect to simulated reader. Please check backend connection.'
                : 'Could not connect to Tap to Pay reader. Ensure Location (GPS) and NFC are enabled in phone settings.'
            );
            appLogger.error('TERMINAL', `Tap to Pay blocked: ${specificReason}`);
            throw new Error(specificReason);
          }
        } else {
          appLogger.info('TERMINAL', 'Reader is verified connected in native SDK.');
        }

        // Check payment status and clear any lingering collection before starting new payment
        try {
          if (typeof getPaymentStatus === 'function') {
            const pStatus = await getPaymentStatus();
            appLogger.info('TERMINAL', `Native getPaymentStatus: "${pStatus}"`);
            if (pStatus === 'waitingForInput') {
              appLogger.info('TERMINAL', 'Clearing previous waitingForInput collection state...');
              await safeCancelCollectPaymentMethod();
            }
          }
        } catch (pErr) {
          appLogger.warn('TERMINAL', 'getPaymentStatus check warning:', pErr);
        }

        setStatusMessage('Creating PaymentIntent on backend...');
        appLogger.info('TERMINAL', `Calling createPaymentIntentOnBackend(amount=${amount}, currency=aud, method=tap)...`);
        const intentRes = await createPaymentIntentOnBackend(amount, 'aud', 'tap', undefined, undefined, routeDetails);
        appLogger.info('TERMINAL', 'Backend createPaymentIntent response:', intentRes);
        const { clientSecret } = intentRes;
        if (!clientSecret) {
          const noSecretErr = 'Backend did not return clientSecret for Tap to Pay PaymentIntent.';
          appLogger.error('TERMINAL', noSecretErr, intentRes);
          throw new Error(noSecretErr);
        }

        setStatusMessage('Retrieving payment details...');
        appLogger.info('TERMINAL', 'Calling retrievePaymentIntent(clientSecret)...');
        const { paymentIntent, error: retrieveError } = await retrievePaymentIntent(clientSecret);
        if (retrieveError || !paymentIntent) {
          const retErrText = `Retrieve PaymentIntent Failed: ${retrieveError?.message || 'Empty intent'} (Code: ${retrieveError?.code || 'UNKNOWN'})`;
          appLogger.error('TERMINAL', retErrText, retrieveError);
          throw new Error(retErrText);
        }
        appLogger.info('TERMINAL', `PaymentIntent retrieved successfully. Status: ${paymentIntent.status}, Amount: ${paymentIntent.amount}`);

        setStatusMessage(
          config.simulatedReader
            ? 'Simulating contactless tap...'
            : 'Ready for tap. Hold card against the back of your phone...'
        );
        appLogger.info('TERMINAL', 'Prompting user to collectPaymentMethod (tap contactless card/phone)...');
        isCollectingRef.current = true;
        let { paymentIntent: collectedIntent, error: collectError } =
          await collectPaymentMethod({ paymentIntent });
        isCollectingRef.current = false;

        // Self-healing retry if collection failed due to unexpected reader disconnect or busy state
        if (
          collectError &&
          (collectError.code === 'NOT_CONNECTED_TO_READER' ||
            collectError.code === 'READER_BUSY' ||
            collectError.code === 'READER_ERROR' ||
            collectError.code === 'COMMAND_TIMEOUT' ||
            collectError.message?.toLowerCase().includes('connect') ||
            collectError.message?.toLowerCase().includes('busy') ||
            collectError.message?.toLowerCase().includes('reader'))
        ) {
          appLogger.warn('TERMINAL', 'Collect attempt failed due to reader state, attempting auto-reconnect & retry...', collectError);
          setStatusMessage('Reconnecting NFC reader...');
          const reconnected = await initAndConnectSimulatedReader(true);
          if (reconnected) {
            setStatusMessage(
              config.simulatedReader
                ? 'Simulating contactless tap...'
                : 'Ready for tap. Hold card against the back of your phone...'
            );
            isCollectingRef.current = true;
            const retryRes = await collectPaymentMethod({ paymentIntent });
            isCollectingRef.current = false;
            collectedIntent = retryRes.paymentIntent;
            collectError = retryRes.error;
          }
        }

        if (collectError || !collectedIntent) {
          const colErrText = `Card Tap Collection Failed: ${collectError?.message || 'Failed to collect payment method'} (Code: ${collectError?.code || 'UNKNOWN'})`;
          appLogger.error('TERMINAL', colErrText, collectError);
          throw new Error(colErrText);
        }
        appLogger.info('TERMINAL', 'Payment method collected successfully! Status: ' + collectedIntent.status, {
          charges: collectedIntent.charges,
        });

        setStatusMessage('Confirming payment with Stripe...');
        appLogger.info('TERMINAL', 'Calling confirmPaymentIntent...');
        const { paymentIntent: confirmedIntent, error: confirmError } =
          await confirmPaymentIntent({ paymentIntent: collectedIntent });

        if (confirmError || !confirmedIntent) {
          const confErrText = `Payment Confirmation Failed: ${confirmError?.message || 'Failed to confirm payment'} (Code: ${confirmError?.code || 'UNKNOWN'})`;
          appLogger.error('TERMINAL', confErrText, confirmError);
          throw new Error(confErrText);
        }

        appLogger.info('TERMINAL', '💳 confirmPaymentIntent response:', confirmedIntent);
        console.log('💳 [STRIPE TAP TO PAY CONFIRMED INTENT]:', JSON.stringify(confirmedIntent, null, 2));

        if (confirmedIntent.status !== 'succeeded') {
          const statusErrText = `Payment not completed. Stripe status: ${confirmedIntent.status}`;
          appLogger.error('TERMINAL', statusErrText, confirmedIntent);
          throw new Error(statusErrText);
        }

        appLogger.info('TERMINAL', '🎉 Payment Successful! Full transaction confirmed by Stripe.');
        setStatusMessage('Payment Successful');
        setIsProcessing(false);
        return { success: true, paymentIntent: confirmedIntent };
      } catch (err: any) {
        const msg = err?.message || 'Payment failed';
        appLogger.error('TERMINAL', `Payment processing failure: ${msg}`, {
          stack: err?.stack,
          raw: err,
        });
        console.error('Payment processing failed:', err);
        setErrorMessage(msg);
        setStatusMessage('Payment Failed');
        return { success: false, error: msg };
      } finally {
        isPaymentInFlightRef.current = false;
        setIsProcessing(false);
      }
    },
    [
      checkIsReaderActuallyConnected,
      initAndConnectSimulatedReader,
      retrievePaymentIntent,
      collectPaymentMethod,
      confirmPaymentIntent,
      safeCancelCollectPaymentMethod,
      getPaymentStatus,
    ]
  );

  const clearError = () => setErrorMessage(null);

  const resetPaymentState = useCallback(() => {
    isPaymentInFlightRef.current = false;
    setIsProcessing(false);
    setErrorMessage(null);
    setStatusMessage('Processing payment...');
    if (isCollectingRef.current) {
      safeCancelCollectPaymentMethod().catch(() => {});
    }
  }, [safeCancelCollectPaymentMethod]);

  return (
    <TerminalContext.Provider
      value={{
        isInitialized,
        isConnecting,
        isProcessing,
        connectedReader,
        statusMessage,
        errorMessage,
        initAndConnectSimulatedReader,
        runSimulatedPayment,
        clearError,
        resetPaymentState,
      }}
    >
      {children}
    </TerminalContext.Provider>
  );
};

export const TerminalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (hasNativeTerminal) {
    return <NativeTerminalProvider>{children}</NativeTerminalProvider>;
  }
  return <SimulatedTerminalProvider>{children}</SimulatedTerminalProvider>;
};

export const useTerminal = () => {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within a TerminalProvider');
  }
  return context;
};
