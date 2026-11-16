import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../context/AuthContext';
import { useConfirmModal } from '../../../context/ConfirmModalContext';
import HeaderBar from '../../common/HeaderBar';
import ReceiptShareModal from '../../common/ReceiptShareModal';
import { normalizeImageUrl } from '../../../utils/assetUtils';
import { formatSydneyToUserDateTime } from '../../../utils/dateUtils';
import {
  dashboardService,
  onDashboardHeaderSync,
  getCachedDashboardHeader,
} from '../../../services/dashboardService';
import { tokenStorage } from '../../../services/tokenStorage';
import { receiptService, ReceiptData } from '../../../services/receiptService';
import { printReceipt, UnifiedReceiptInput } from '../../../services/receiptExportService';
import { getPaymentStatusInfo } from '../../common/PaymentStatusBadge';

export default function OtherBusinessReceiptScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { showAlert } = useConfirmModal();

  const params = useLocalSearchParams<{
    amount?: string;
    method?: string;
    paymentId?: string;
    txnId?: string;
    cardLast4?: string;
    cardBrand?: string;
    dateStr?: string;
    abn?: string;
    phone?: string;
    businessName?: string;
    businessLogo?: string;
    receiptJson?: string;
    service_charges?: string;
    payment_status?: string;
    reason?: string;
  }>();

  const rawAmount = params.amount || '0.00';
  const numericAmount = parseFloat(rawAmount) || 0;
  const method = (params.method || 'tap').toLowerCase();
  const isCash = method === 'cash';
  const isTap = method === 'tap';

  const cardBrand = isCash
    ? 'Cash'
    : (params.cardBrand || (isTap ? 'Contactless' : 'Visa')).trim();
  const cardLast4 = isCash ? '' : (params.cardLast4 || '••••');

  const [receiptData, setReceiptData] = useState<ReceiptData | null>(() => {
    if (params.receiptJson) {
      try {
        const parsed = JSON.parse(params.receiptJson);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch { }
    }
    return (
      receiptService.getCachedReceipt(params.paymentId) ||
      receiptService.getCachedReceipt(params.txnId)
    );
  });

  const rawParamId =
    (params.paymentId && params.paymentId !== '--' && params.paymentId !== 'CASH-PAYMENT' ? params.paymentId : '') ||
    (params.txnId && params.txnId !== '--' && params.txnId !== 'CASH-PAYMENT' ? params.txnId : '');
  const paymentId = receiptData?.payment_id || rawParamId || '--';

  useEffect(() => {
    const lookupId = rawParamId;
    if (lookupId) {
      let isMounted = true;
      receiptService
        .getReceipt(lookupId)
        .then((data) => {
          if (isMounted && data) {
            setReceiptData(data);
          }
        })
        .catch(() => { });
      return () => {
        isMounted = false;
      };
    }
  }, [rawParamId]);

  const dateStr =
    (params.dateStr && params.dateStr.trim() !== '' && params.dateStr !== '--'
      ? formatSydneyToUserDateTime(params.dateStr) || params.dateStr
      : null) || formatSydneyToUserDateTime(new Date());

  const cachedHeader = getCachedDashboardHeader();
  const cachedUser = tokenStorage.getCachedUser();

  const [extraHeader, setExtraHeader] = useState<{ abn?: string; phone?: string }>({
    abn:
      (params.abn && params.abn !== '--' ? params.abn : undefined) ||
      user?.abn ||
      cachedHeader?.abn ||
      cachedUser?.abn,
    phone:
      (params.phone && params.phone !== '--' ? params.phone : undefined) ||
      user?.phone ||
      cachedHeader?.phone ||
      cachedUser?.phone,
  });

  useEffect(() => {
    const unsub = onDashboardHeaderSync((h) => {
      if (h.abn || h.phone) {
        setExtraHeader((prev) => ({
          abn: h.abn || prev.abn,
          phone: h.phone || prev.phone,
        }));
      }
    });

    dashboardService
      .getDashboard()
      .then((res) => {
        if (res?.data?.header) {
          setExtraHeader((prev) => ({
            abn: res.data.header.abn || prev.abn,
            phone: res.data.header.phone || prev.phone,
          }));
        }
      })
      .catch(() => { });

    return () => unsub();
  }, []);

  const businessName =
    receiptData?.business_name || user?.businessName || user?.name || '--';
  const logoUrl = normalizeImageUrl(
    receiptData?.business_logo || user?.logoUrl || cachedHeader?.logo_url
  );
  const address =
    receiptData?.address || user?.businessAddress || '--';
  const empId =
    receiptData?.employee_id || user?.empId || '--';

  const hasAdBanner = Boolean(receiptData?.ad_banner && receiptData?.banner_image_url);
  const bannerImageUrl = normalizeImageUrl(receiptData?.banner_image_url);

  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);

  const isLogoValid = Boolean(logoUrl) && failedLogoUrl !== logoUrl;

  const effectiveNumericAmount =
    receiptData?.amount !== undefined && receiptData?.amount !== null
      ? receiptData.amount
      : numericAmount;

  const abn =
    receiptData?.abn ||
    (params.abn && params.abn.trim() !== '' && params.abn !== '--' ? params.abn : null) ||
    extraHeader.abn ||
    user?.abn ||
    cachedHeader?.abn ||
    cachedUser?.abn ||
    '--';

  const phone =
    receiptData?.phone_no ||
    (params.phone && params.phone.trim() !== '' && params.phone !== '--' ? params.phone : null) ||
    extraHeader.phone ||
    user?.phone ||
    cachedHeader?.phone ||
    cachedUser?.phone ||
    '--';

  const cardBrandFinal =
    receiptData?.card_brand || cardBrand;

  const paymentMethodLabel =
    receiptData?.payment_method || (isCash ? 'Cash Payment' : `${cardBrandFinal} •••• ${cardLast4}`);

  const paymentMethodBadgeLabel =
    receiptData?.payment_type || receiptData?.payment_method_badge || (isCash ? 'Cash' : isTap ? 'Tap & Go' : 'Card');

  const effectiveDateStr =
    receiptData?.date_time ? formatSydneyToUserDateTime(receiptData.date_time) : dateStr;

  // Amount formatting: integer and decimal parts
  const formattedWithComma = Math.floor(effectiveNumericAmount).toLocaleString('en-US');
  const decimalPart = effectiveNumericAmount.toFixed(2).split('.')[1] || '00';

  // Payment Breakdown (POST /api/payment/fees or GET /api/receipt/:id)
  const breakdown = useMemo(() => {
    if (receiptData?.payment_break_down) {
      return receiptData.payment_break_down;
    }
    if ((receiptData as any)?.payment_breakdown) {
      return (receiptData as any).payment_breakdown;
    }
    const paramFee =
      params.service_charges !== undefined && params.service_charges !== ''
        ? Number(params.service_charges)
        : null;
    const fee = paramFee !== null && !isNaN(paramFee) && paramFee >= 0 ? paramFee : 0;
    return {
      payable_amount: effectiveNumericAmount,
      service_fee: fee,
      base_amount: Math.max(0, effectiveNumericAmount - fee),
    };
  }, [receiptData, params.service_charges, effectiveNumericAmount]);

  const hasBreakdown = true;

  const breakdownBaseAmount =
    breakdown?.base_amount !== undefined && breakdown?.base_amount !== null
      ? Number(breakdown.base_amount)
      : breakdown?.payable_amount !== undefined && breakdown?.service_fee !== undefined
        ? Number(breakdown.payable_amount) - Number(breakdown.service_fee)
        : effectiveNumericAmount;

  const breakdownServiceFee =
    breakdown?.service_fee !== undefined && breakdown?.service_fee !== null
      ? Number(breakdown.service_fee)
      : 0;

  const breakdownPayableAmount =
    breakdown?.payable_amount !== undefined && breakdown?.payable_amount !== null
      ? Number(breakdown.payable_amount)
      : effectiveNumericAmount;

  const [isPrinting, setIsPrinting] = useState(false);
  const [isShareModalVisible, setIsShareModalVisible] = useState(false);

  const paymentStatusVal = receiptData?.payment_status || params.payment_status || 'PAID';
  const reasonVal = receiptData?.reason || params.reason || null;
  const statusInfo = getPaymentStatusInfo(paymentStatusVal, reasonVal);

  const receiptInput: UnifiedReceiptInput = useMemo(() => {
    return {
      businessName,
      businessLogo: logoUrl,
      abn,
      phone,
      amount: effectiveNumericAmount,
      amountFormatted: receiptData?.amount_formatted || `$${formattedWithComma}.${decimalPart}`,
      dateTime: effectiveDateStr,
      paymentMethod: paymentMethodLabel,
      paymentType: paymentMethodBadgeLabel,
      cardBrand: cardBrandFinal,
      paymentId,
      paymentStatus: paymentStatusVal,
      reason: reasonVal,
      isTaxi: false,
      address,
      staffName: user?.name,
      staffEmpId: empId,
      hasAdBanner,
      bannerImageUrl,
      breakdown,
    };
  }, [
    businessName,
    logoUrl,
    abn,
    phone,
    effectiveNumericAmount,
    formattedWithComma,
    decimalPart,
    effectiveDateStr,
    paymentMethodLabel,
    paymentMethodBadgeLabel,
    cardBrandFinal,
    paymentId,
    paymentStatusVal,
    reasonVal,
    address,
    user?.name,
    empId,
    hasAdBanner,
    bannerImageUrl,
    breakdown,
    receiptData?.amount_formatted,
  ]);

  const handleOpenShareMenu = () => {
    setIsShareModalVisible(true);
  };

  const handlePrint = async () => {
    try {
      setIsPrinting(true);
      await printReceipt(receiptInput);
    } catch (error) {
      console.error('Error printing receipt:', error);
    } finally {
      setIsPrinting(false);
    }
  };

  const handleCopyPaymentId = () => {
    showAlert({
      title: 'Payment ID',
      message: `${paymentId}\nCopied to clipboard.`,
      type: 'info',
      icon: 'information-circle-outline',
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* ── Top Header ── */}
      <HeaderBar
        title="Receipt"
        showBack
        onBack={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/(tabs)');
          }
        }}
        rightAction={
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={handleOpenShareMenu}
            activeOpacity={0.6}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="share-outline" size={22} color="#0F172A" />
          </TouchableOpacity>
        }
      />

      <View
        style={[
          styles.root,
          {
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Main Receipt Card ── */}
          <View style={styles.receiptCard}>
            {/* Top Avatar Logo Box */}
            <View style={styles.logoBadgeContainer}>
              <View style={styles.logoBox}>
                {isLogoValid ? (
                  <Image
                    source={{ uri: logoUrl! }}
                    style={styles.logoImage}
                    resizeMode="cover"
                    onError={() => setFailedLogoUrl(logoUrl)}
                  />
                ) : (
                  <Feather name="briefcase" size={24} color="#D97706" />
                )}
              </View>
            </View>

            {/* Business Info Header */}
            <Text style={styles.bizName}>{businessName}</Text>
            <Text style={styles.bizMeta}>
              ABN: {abn} • PH: {phone}
            </Text>
            {address && address !== '--' ? <Text style={styles.bizAddress}>{address}</Text> : null}
            <Text style={styles.empIdText}>
              EMP ID: <Text style={styles.empIdBold}>{empId}</Text>
            </Text>

            {/* Amount and Status Pill Badge */}
            <View style={styles.amountSection}>
              <Text style={styles.totalPaidLabel}>
                {statusInfo.isFailed
                  ? 'TOTAL AMOUNT (FAILED)'
                  : statusInfo.isPending
                    ? 'TOTAL AMOUNT (PENDING)'
                    : 'TOTAL PAID (INC GST)'}
              </Text>

              <View style={styles.amountWrap}>
                <Text style={[styles.dollarSign, statusInfo.isFailed && { color: '#DC2626' }]}>$ </Text>
                <Text style={[styles.amountInt, statusInfo.isFailed && { color: '#DC2626' }]}>{formattedWithComma}</Text>
                <Text style={[styles.amountDec, statusInfo.isFailed && { color: '#DC2626' }]}>.{decimalPart}</Text>
              </View>

              {statusInfo.isFailed ? (
                <View style={[styles.paidBadge, styles.failedBadge]}>
                  <View style={styles.redDot} />
                  <Text style={styles.failedText}>FAILED</Text>
                </View>
              ) : statusInfo.isPending ? (
                <View style={[styles.paidBadge, styles.pendingBadge]}>
                  <View style={styles.amberDot} />
                  <Text style={styles.pendingText}>PENDING</Text>
                </View>
              ) : (
                <View style={styles.paidBadge}>
                  <View style={styles.greenDot} />
                  <Text style={styles.paidText}>PAID</Text>
                </View>
              )}

              {/* Reason callout if failed or pending */}
              {(statusInfo.isFailed || statusInfo.isPending) && statusInfo.reason && (
                <View
                  style={[
                    styles.reasonBox,
                    statusInfo.isFailed ? styles.reasonBoxFailed : styles.reasonBoxPending,
                  ]}
                >
                  <Ionicons
                    name={statusInfo.isFailed ? 'alert-circle-outline' : 'time-outline'}
                    size={14}
                    color={statusInfo.isFailed ? '#DC2626' : '#D97706'}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.reasonBoxText,
                      statusInfo.isFailed ? styles.reasonBoxTextFailed : styles.reasonBoxTextPending,
                    ]}
                  >
                    <Text style={{ fontWeight: '700' }}>Reason: </Text>
                    {statusInfo.reason}
                  </Text>
                </View>
              )}
            </View>

            {/* Divider */}
            <View style={styles.cardDivider} />

            {/* ── Payment Breakdown Section ── */}
            {hasBreakdown && breakdownBaseAmount !== null && (
              <>
                <View style={styles.breakdownCard}>
                  <View style={styles.breakdownHeaderRow}>
                    <Text style={styles.breakdownHeaderTitle}>PAYMENT BREAKDOWN</Text>
                  </View>

                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Base Amount</Text>
                    <Text style={styles.breakdownValue}>
                      ${Number(breakdownBaseAmount).toFixed(2)}
                    </Text>
                  </View>

                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Service Fee</Text>
                    <Text style={styles.breakdownValue}>
                      ${Number(breakdownServiceFee).toFixed(2)}
                    </Text>
                  </View>

                  <View style={styles.breakdownInnerDivider} />

                  <View style={styles.breakdownTotalRow}>
                    <Text style={styles.breakdownTotalLabel}>
                      Total <Text style={styles.breakdownIncGst}>(INC GST)</Text>
                    </Text>
                    <Text style={styles.breakdownTotalValue}>
                      ${Number(breakdownPayableAmount).toFixed(2)}
                    </Text>
                  </View>
                </View>

                {/* Divider */}
                <View style={styles.cardDivider} />
              </>
            )}

            {/* ── Meta Information Rows ── */}
            <View style={styles.metaList}>
              {/* Row 1: Date & Time */}
              <View style={styles.metaRow}>
                <View>
                  <Text style={styles.metaLabel}>Date & Time</Text>
                  <Text style={styles.metaValue}>{effectiveDateStr}</Text>
                </View>
                <View style={[styles.methodCapsule, isCash && styles.cashMethodCapsule]}>
                  <Ionicons
                    name={isCash ? 'cash-outline' : isTap ? 'sparkles' : 'card'}
                    size={11}
                    color={isCash ? '#059669' : '#B45309'}
                    style={{ marginRight: 4 }}
                  />
                  <Text style={[styles.methodCapsuleText, isCash && styles.cashMethodCapsuleText]}>
                    {paymentMethodBadgeLabel}
                  </Text>
                </View>
              </View>

              {/* Row 2: Payment Method */}
              <View style={styles.metaRow}>
                <View>
                  <Text style={styles.metaLabel}>Payment Method</Text>
                  <Text style={styles.metaValue}>
                    {paymentMethodLabel}
                  </Text>
                </View>
                {isCash ? (
                  <View style={styles.cashPill}>
                    <Text style={styles.cashPillText}>CASH</Text>
                  </View>
                ) : isTap && cardBrandFinal === 'Contactless' ? (
                  <View style={styles.tapPill}>
                    <Text style={styles.tapPillText}>TAP & GO</Text>
                  </View>
                ) : cardBrandFinal.toUpperCase() === 'MASTERCARD' ? (
                  <View style={styles.mastercardPill}>
                    <Text style={styles.mastercardPillText}>MASTERCARD</Text>
                  </View>
                ) : (
                  <View style={styles.visaPill}>
                    <Text style={styles.visaPillText}>{cardBrandFinal.toUpperCase() || 'VISA'}</Text>
                  </View>
                )}
              </View>

              {/* Row 3: Payment ID */}
              <View style={styles.metaRow}>
                <View>
                  <Text style={styles.metaLabel}>{isCash ? 'Receipt ID' : 'Payment ID'}</Text>
                  <Text style={styles.metaValue}>{paymentId}</Text>
                </View>
                <TouchableOpacity
                  onPress={handleCopyPaymentId}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="copy-outline" size={18} color="#94A3B8" />
                </TouchableOpacity>
              </View>
            </View>

            {/* ── Footer Inside Card ── */}
            <View style={styles.receiptFooter}>
              <Text style={styles.thankYouText}>
                THANK YOU FOR CHOOSING {businessName.toUpperCase()}
              </Text>
              <Text style={styles.poweredByText}>POWERED BY</Text>

              <Image
                source={require('../../../../assets/SE-pay-logo-gif.gif')}
                style={styles.sePayLogo}
                resizeMode="contain"
              />
            </View>
          </View>

          {/* ── Bottom Action Buttons ── */}
          <View style={styles.actions}>
            {/* 1. Print Digital Receipt (Golden Button) */}
            <TouchableOpacity
              style={styles.printBtn}
              onPress={handlePrint}
              disabled={isPrinting}
              activeOpacity={0.85}
            >
              {isPrinting ? (
                <ActivityIndicator size="small" color="#0F172A" style={{ marginRight: 6 }} />
              ) : (
                <Ionicons name="print-outline" size={17} color="#0F172A" style={{ marginRight: 6 }} />
              )}
              <Text style={styles.printBtnText} numberOfLines={1} adjustsFontSizeToFit>
                Print Digital Receipt
              </Text>
            </TouchableOpacity>

            {/* 2. Share Digital Receipt Via (White Card Button) */}
            <TouchableOpacity
              style={styles.shareBtn}
              onPress={handleOpenShareMenu}
              activeOpacity={0.8}
            >
              <Ionicons name="share-outline" size={17} color="#2563EB" style={{ marginRight: 6 }} />
              <Text style={styles.shareBtnText} numberOfLines={1} adjustsFontSizeToFit>
                Share Digital Receipt
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 20 }} />
        </ScrollView>
      </View>

      {/* ── UNIFIED RECEIPT SHARE MODAL (PNG, GIF, PDF) ── */}
      <ReceiptShareModal
        visible={isShareModalVisible}
        onClose={() => setIsShareModalVisible(false)}
        receiptInput={receiptInput}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  root: {
    flex: 1,
  },
  headerBtn: {
    padding: 6,
    marginRight: 4,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 24,
  },

  /* ── Main Receipt Card ── */
  receiptCard: {
    backgroundColor: '#FFFDF7',
    borderWidth: 1.5,
    borderColor: '#FEF08A',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    marginBottom: 12,
  },

  /* Logo Badge */
  logoBadgeContainer: {
    alignItems: 'center',
    marginBottom: 8,
  },
  logoBox: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#FEF9C3',
    borderWidth: 1,
    borderColor: '#FDE047',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },

  /* Business Info */
  bizName: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 2,
    letterSpacing: -0.2,
  },
  bizMeta: {
    fontSize: 10.5,
    fontWeight: '500',
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 1,
  },
  bizAddress: {
    fontSize: 10,
    fontWeight: '500',
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 1,
  },
  empIdText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#94A3B8',
    textAlign: 'center',
  },
  empIdBold: {
    fontWeight: '700',
    color: '#0F172A',
  },

  /* Amount Section */
  amountSection: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  totalPaidLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: '#64748B',
    marginBottom: 2,
  },
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  dollarSign: {
    fontSize: 22,
    fontWeight: '800',
    color: '#D97706',
    marginRight: 2,
  },
  amountInt: {
    fontSize: 34,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  amountDec: {
    fontSize: 20,
    fontWeight: '700',
    color: '#475569',
  },
  paidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 5,
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  paidText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#166534',
    letterSpacing: 0.6,
  },
  failedBadge: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FECACA',
  },
  redDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#DC2626',
  },
  failedText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#DC2626',
    letterSpacing: 0.6,
  },
  pendingBadge: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  amberDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D97706',
  },
  pendingText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#D97706',
    letterSpacing: 0.6,
  },
  reasonBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 8,
    maxWidth: '92%',
  },
  reasonBoxFailed: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  reasonBoxPending: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  reasonBoxText: {
    fontSize: 11,
    flexShrink: 1,
    lineHeight: 15,
  },
  reasonBoxTextFailed: {
    color: '#991B1B',
  },
  reasonBoxTextPending: {
    color: '#92400E',
  },

  /* Card Divider */
  cardDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 10,
    width: '100%',
  },
  breakdownCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginVertical: 4,
  },
  breakdownHeaderRow: {
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 4,
  },
  breakdownHeaderTitle: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  breakdownLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  breakdownValue: {
    fontSize: 12.5,
    color: '#0F172A',
    fontWeight: '700',
  },
  breakdownInnerDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 6,
  },
  breakdownTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownTotalLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  breakdownIncGst: {
    fontSize: 9.5,
    fontWeight: '600',
    color: '#64748B',
  },
  breakdownTotalValue: {
    fontSize: 14,
    fontWeight: '900',
    color: '#D97706',
  },

  /* Meta Information Rows */
  metaList: {
    gap: 8,
    paddingHorizontal: 2,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaLabel: {
    fontSize: 10.5,
    fontWeight: '500',
    color: '#94A3B8',
  },
  metaValue: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 1,
  },
  methodCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FEF08A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  methodCapsuleText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#B45309',
  },
  cashMethodCapsule: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  cashMethodCapsuleText: {
    color: '#059669',
  },
  cashPill: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 4,
  },
  cashPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.5,
  },
  tapPill: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FEF08A',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 4,
  },
  tapPillText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.5,
  },
  mastercardPill: {
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 4,
  },
  mastercardPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#E11D48',
  },
  visaPill: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 4,
  },
  visaPillText: {
    fontSize: 11,
    fontStyle: 'italic',
    fontWeight: '800',
    color: '#1D4ED8',
  },

  /* Card Footer */
  receiptFooter: {
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  thankYouText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 2,
  },
  poweredByText: {
    fontSize: 8.5,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginBottom: 4,
  },
  sePayLogo: {
    width: 105,
    height: 24,
  },

  /* ── Action Buttons ── */
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    gap: 10,
  },
  printBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FBBF24',
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 8,
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  printBtnText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  shareBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F172A',
  },
});
