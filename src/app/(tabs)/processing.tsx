import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Animated,
  Easing,
  Platform,
  Image,
  TouchableOpacity,
  BackHandler,
} from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTerminal } from '../../context/TerminalContext';
import { addTransaction } from '../../services/transactionStore';
import { calculateFee, type PaymentMethodType } from '../../utils/feeCalculator';
import { paymentSession } from '../../services/paymentSession';
import { dashboardService } from '../../services/dashboardService';

const RING_SIZE = 210;
const STROKE_WIDTH = 5.5;
const RADIUS = (RING_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function ProcessingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    amount?: string;
    method?: string;
    service_charges?: string;
    cardInput?: string;
    pickup?: string;
    dropoff?: string;
    pickup_location?: string;
    dropup_location?: string;
    pickup_id?: string;
    dropup_id?: string;
    dropoff_id?: string;
    payment_attempt_id?: string;
    shift_session_id?: string;
  }>();

  const { runSimulatedPayment, statusMessage, errorMessage, resetPaymentState } = useTerminal();
  const [isFailed, setIsFailed] = useState(false);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isPaymentCompleted, setIsPaymentCompleted] = useState(false);

  const rawAmount = params.amount || '0';
  const numericAmount = parseFloat(rawAmount) || 0;
  const paymentMethod: PaymentMethodType = params.method === 'card' ? 'card' : 'tap';

  const parsedCardInput = useMemo(() => {
    if (!params.cardInput) return undefined;
    try {
      return JSON.parse(params.cardInput);
    } catch {
      return undefined;
    }
  }, [params.cardInput]);

  // Continuous smooth linear rotation of the gold arc
  const [rotateAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 2200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, [rotateAnim]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const paymentStateRef = useRef({
    numericAmount,
    rawAmount,
    paymentMethod,
    service_charges: params.service_charges ? Number(params.service_charges) : undefined,
    parsedCardInput,
    pickup: params.pickup || '',
    dropoff: params.dropoff || '',
    pickup_location: params.pickup_location || '',
    dropup_location: params.dropup_location || '',
    pickup_id: params.pickup_id || '',
    dropup_id: params.dropup_id || params.dropoff_id || '',
    dropoff_id: params.dropup_id || params.dropoff_id || '',
    shift_session_id: params.shift_session_id || '',
    runSimulatedPayment,
    router,
  });

  useEffect(() => {
    paymentStateRef.current = {
      numericAmount,
      rawAmount,
      paymentMethod,
      service_charges: params.service_charges ? Number(params.service_charges) : undefined,
      parsedCardInput,
      pickup: params.pickup || '',
      dropoff: params.dropoff || '',
      pickup_location: params.pickup_location || '',
      dropup_location: params.dropup_location || '',
      pickup_id: params.pickup_id || '',
      dropup_id: params.dropup_id || params.dropoff_id || '',
      dropoff_id: params.dropup_id || params.dropoff_id || '',
      shift_session_id: params.shift_session_id || '',
      runSimulatedPayment,
      router,
    };
  });

  const isExecutingRef = useRef(false);
  const executedAttemptKeyRef = useRef<string>('');
  const successNavTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Intercept Android hardware back button during in-flight payments to prevent accidental jumps to home
  useEffect(() => {
    const onBackPress = () => {
      // If payment is actively executing, intercept and block back navigation
      if (isExecutingRef.current && !isFailed) {
        return true;
      }
      return false;
    };

    const backSub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backSub.remove();
  }, [isFailed]);

  // Whenever the processing screen gains focus, prepare for a fresh payment run
  useFocusEffect(
    useCallback(() => {
      setIsFailed(false);
      setErrorReason(null);
      setIsPaymentCompleted(false);

      return () => {
        // When leaving processing screen, release all execution locks and reset terminal state
        isExecutingRef.current = false;
        executedAttemptKeyRef.current = '';
        setIsPaymentCompleted(false);
        if (successNavTimerRef.current) {
          clearTimeout(successNavTimerRef.current);
          successNavTimerRef.current = null;
        }
        if (resetPaymentState) {
          resetPaymentState();
        }
      };
    }, [resetPaymentState])
  );

  const attemptId = params.payment_attempt_id || '';
  const currentExecutionKey = `${params.amount || '0'}_${params.method || 'tap'}_${attemptId}_${retryCount}`;

  useEffect(() => {
    // Strictly prevent duplicate payment API calls for the same attempt key or during active flight
    if (executedAttemptKeyRef.current === currentExecutionKey || isExecutingRef.current) {
      return;
    }
    executedAttemptKeyRef.current = currentExecutionKey;
    isExecutingRef.current = true;

    async function process() {
      const {
        numericAmount: amt,
        rawAmount: rawAmt,
        paymentMethod: method,
        service_charges,
        parsedCardInput: cardInput,
        pickup,
        dropoff,
        pickup_location: pickLoc,
        dropup_location: dropLoc,
        pickup_id: pId,
        dropup_id: dId,
        shift_session_id: sId,
        runSimulatedPayment: executePayment,
        router: navRouter,
      } = paymentStateRef.current;

      try {
        const feeBreakdown = calculateFee(amt, method);
        const result = await executePayment(amt, method, feeBreakdown, cardInput, {
          service_charges: service_charges !== undefined ? service_charges : 0,
          pickup_id: pId ? (Number(pId) || pId) : null,
          dropup_id: dId ? (Number(dId) || dId) : null,
          pickup_location: pickLoc || null,
          dropup_location: dropLoc || null,
          shift_session_id: sId || null,
          payment_attempt_id: attemptId || undefined,
        });

        if (result.success && result.paymentIntent) {
          setIsPaymentCompleted(true);
          const pi = result.paymentIntent;
          const charge = pi.charges?.[0];
          const cardDetails =
            charge?.paymentMethodDetails?.cardPresentDetails ||
            charge?.paymentMethodDetails?.cardDetails;

          const rawBrand = cardDetails?.brand || (cardInput ? 'Card' : 'Contactless');
          const brand = rawBrand.charAt(0).toUpperCase() + rawBrand.slice(1);
          const last4 = cardDetails?.last4 || cardInput?.number?.slice(-4) || '••••';
          const realTxnId = pi.id || pi.paymentIntentId || charge?.paymentIntentId || charge?.id || '--';
          const timestamp = new Date().toISOString();

          addTransaction({
            id: realTxnId,
            amount: amt,
            originalAmount: amt,
            fee: feeBreakdown.totalFee,
            percentageFee: feeBreakdown.percentageFee,
            fixedFee: feeBreakdown.fixedFee,
            currency: '$',
            status: 'success',
            paymentMethod: method === 'tap' ? 'Tap to Pay' : 'Card',
            paymentMethodType: method,
            cardLast4: last4,
            cardBrand: brand,
            paymentId: realTxnId,
            storeName: 'SE PAY',
            timestamp,
          });

          // Proactively refresh dashboard and notify payment listeners
          paymentSession.markPaymentCompleted();
          dashboardService.getDashboard().catch(() => {});

          // Transition to Payment Successful screen after brief display of success state
          successNavTimerRef.current = setTimeout(() => {
            navRouter.replace({
              pathname: '/(tabs)/payment-success',
              params: {
                amount: rawAmt,
                method,
                paymentId: realTxnId,
                cardLast4: last4,
                cardBrand: brand,
                timestamp,
                pickup,
                dropoff,
                pickup_id: pId || '',
                dropup_id: dId || '',
                dropoff_id: dId || '',
                service_charges: service_charges !== undefined ? String(service_charges) : '',
              },
            });
          }, 450);
        } else {
          setIsFailed(true);
          const rawErr = result.error || errorMessage || 'Payment could not be completed.';
          let friendlyErr = rawErr;
          if (/customer_cancel|canceled|cancelled|customer canceled/i.test(rawErr)) {
            friendlyErr = 'Card tap or PIN verification was cancelled. Please tap "Try Again" to retry the payment.';
          } else if (/incorrect.*pin|wrong.*pin/i.test(rawErr)) {
            friendlyErr = 'Incorrect card PIN entered. Please tap "Try Again" to retry with the correct PIN.';
          } else if (/pin.*required|pin.*needed/i.test(rawErr)) {
            friendlyErr = 'Card PIN required for this transaction. Please tap "Try Again" and enter the PIN, or ask customer to tap via Apple Pay or Google Wallet.';
          }
          setErrorReason(friendlyErr);
        }
      } catch (err: any) {
        setIsFailed(true);
        const rawErr = err?.message || 'An unexpected error occurred while processing payment.';
        let friendlyErr = rawErr;
        if (/customer_cancel|canceled|cancelled|customer canceled/i.test(rawErr)) {
          friendlyErr = 'Card tap or PIN verification was cancelled. Please tap "Try Again" to retry the payment.';
        } else if (/incorrect.*pin|wrong.*pin/i.test(rawErr)) {
          friendlyErr = 'Incorrect card PIN entered. Please tap "Try Again" to retry with the correct PIN.';
        }
        setErrorReason(friendlyErr);
      } finally {
        isExecutingRef.current = false;
      }
    }

    process();
  }, [currentExecutionKey, errorMessage, attemptId]);

  const handleRetry = () => {
    if (isExecutingRef.current) return;
    setIsFailed(false);
    setErrorReason(null);
    setIsPaymentCompleted(false);
    executedAttemptKeyRef.current = '';
    setRetryCount((c) => c + 1);
  };

  const handleCancel = () => {
    if (isExecutingRef.current) return;
    router.replace('/(tabs)/tap-to-pay');
  };

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: Math.max(insets.top, Platform.OS === 'android' ? 24 : 16),
          paddingBottom: Math.max(insets.bottom, 24),
        },
      ]}
    >
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {isFailed ? (
        <View style={styles.centerSection}>
          <View style={styles.errorIconWrap}>
            <Ionicons name="close-circle-outline" size={64} color="#EF4444" />
          </View>
          <Text style={styles.title}>Payment Failed</Text>

          <View style={styles.errorCard}>
            <Text style={styles.errorSubtitle} selectable>
              {errorReason}
            </Text>
          </View>

          {/* Contextual guidance if amount is >= 100 or error indicates PIN/decline */}
          {paymentMethod === 'tap' && (numericAmount >= 100 || /pin|limit|cvm|decline/i.test(errorReason || '')) && (
            <View style={styles.pinHintBox}>
              <Ionicons name="bulb-outline" size={16} color="#B45309" style={{ marginRight: 8, marginTop: 1 }} />
              <Text style={styles.pinHintText}>
                In Australia, physical card taps over $100–$200 may require a PIN or chip reader. Ask the customer to tap using Apple Pay or Google Wallet (no limit), or try again.
              </Text>
            </View>
          )}

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.retryBtn} onPress={handleRetry} activeOpacity={0.85}>
              <Text style={styles.retryBtnText}>Try Again</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.85}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* ── Central Processing Container ── */
        <View style={styles.centerSection}>
          {/* Circle with Radial Glow, Rotating Dual-Tone Arc, and Unicorn */}
          <View style={styles.circleContainer}>
            {/* Inner Soft Warm Radial Glow */}
            <Svg
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              style={styles.glowSvg}
            >
              <Defs>
                <RadialGradient
                  id="innerGlow"
                  cx="50%"
                  cy="50%"
                  rx="50%"
                  ry="50%"
                  fx="50%"
                  fy="50%"
                >
                  <Stop offset="0%" stopColor="#FEF9C3" stopOpacity="0.85" />
                  <Stop offset="65%" stopColor="#FFFBEB" stopOpacity="0.45" />
                  <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
                </RadialGradient>
              </Defs>
              <Circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RADIUS - STROKE_WIDTH / 2}
                fill="url(#innerGlow)"
              />
            </Svg>

            {/* Rotating Two-Tone Ring (Dark Navy with Gold Active Arc) */}
            <Animated.View
              style={[
                styles.rotatingRing,
                {
                  transform: [{ rotate: spin }],
                },
              ]}
            >
              <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
                {/* Dark Navy Base Ring (~65% arc visible) */}
                <Circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RADIUS}
                  stroke="#1E293B"
                  strokeWidth={STROKE_WIDTH}
                  fill="none"
                />
                {/* Vibrant Gold Active Progress Segment (~35% of circle) */}
                <Circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RADIUS}
                  stroke="#F59E0B"
                  strokeWidth={STROKE_WIDTH}
                  strokeDasharray={`${CIRCUMFERENCE * 0.35} ${CIRCUMFERENCE * 0.65}`}
                  strokeDashoffset={CIRCUMFERENCE * 0.1}
                  strokeLinecap="round"
                  fill="none"
                />
              </Svg>
            </Animated.View>

            {/* Centered SE PAY Unicorn Mascot Emblem */}
            <View style={styles.unicornWrap}>
              <Image
                source={require('../../../assets/se_pay_unicorn.png')}
                style={styles.unicornImage}
                resizeMode="contain"
              />
            </View>
          </View>

          {/* ── Status Text ── */}
          <Text style={styles.title}>
            {isPaymentCompleted
              ? 'Payment Successful'
              : statusMessage === 'Payment Successful'
                ? (paymentMethod === 'card' ? 'Processing card payment...' : 'Processing contactless payment...')
                : statusMessage || 'Processing payment...'}
          </Text>
          <Text style={styles.subtitle}>{"Please don't remove or move the card."}</Text>
        </View>
      )}

      {/* Non-dismissible touch shield while payment is actively in-flight to prevent screen dismissals */}
      {!isFailed && !isPaymentCompleted && (
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents="auto"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerSection: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingHorizontal: 24,
  },
  circleContainer: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 44,
  },
  glowSvg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  rotatingRing: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    top: 0,
    left: 0,
  },
  unicornWrap: {
    position: 'absolute',
    width: 82,
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  unicornImage: {
    width: 82,
    height: 110,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12.5,
    color: '#64748B',
    textAlign: 'center',
    fontWeight: '500',
  },
  errorIconWrap: {
    marginBottom: 16,
  },
  errorCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FEE2E2',
    borderRadius: 12,
    padding: 14,
    width: '100%',
    marginBottom: 24,
  },
  errorSubtitle: {
    fontSize: 13,
    color: '#991B1B',
    textAlign: 'center',
    fontWeight: '500',
    lineHeight: 18,
  },
  pinHintBox: {
    flexDirection: 'row',
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    width: '100%',
    alignItems: 'flex-start',
  },
  pinHintText: {
    fontSize: 12.5,
    color: '#92400E',
    flex: 1,
    lineHeight: 17,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  retryBtn: {
    backgroundColor: '#0F172A',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  cancelBtn: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  cancelBtnText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '600',
  },
  diagnosticsContainer: {
    width: '100%',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  shareLogsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 10,
    width: '100%',
  },
  shareLogsBtnText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
  },
  viewLogsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  viewLogsBtnText: {
    color: '#64748B',
    fontSize: 12.5,
    fontWeight: '600',
  },
});
