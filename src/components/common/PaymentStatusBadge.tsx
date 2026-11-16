import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface PaymentStatusInfo {
  isFailed: boolean;
  isPending: boolean;
  isSuccess: boolean;
  rawStatus: string;
  label: string;
  badgeBg: string;
  badgeBorder: string;
  textColor: string;
  reason: string | null;
}

export function getPaymentStatusInfo(
  status?: string | null,
  reason?: string | null
): PaymentStatusInfo {
  const raw = (status || '').toLowerCase().trim();
  const isFailed = raw === 'failed' || raw === 'failure' || raw === 'declined' || raw === 'cancelled';
  const isPending = raw === 'pending' || raw === 'processing';
  const isSuccess = raw === 'success' || raw === 'paid' || raw === 'settled';

  const cleanReason =
    reason && reason.trim().length > 0 && reason.trim().toLowerCase() !== 'success'
      ? reason.trim()
      : null;

  if (isFailed) {
    return {
      isFailed: true,
      isPending: false,
      isSuccess: false,
      rawStatus: raw,
      label: 'FAILED',
      badgeBg: '#FEE2E2',
      badgeBorder: '#FECACA',
      textColor: '#DC2626',
      reason: cleanReason,
    };
  }

  if (isPending) {
    return {
      isFailed: false,
      isPending: true,
      isSuccess: false,
      rawStatus: raw,
      label: 'PENDING',
      badgeBg: '#FEF3C7',
      badgeBorder: '#FDE68A',
      textColor: '#D97706',
      reason: cleanReason,
    };
  }

  return {
    isFailed: false,
    isPending: false,
    isSuccess: isSuccess || raw.length === 0,
    rawStatus: raw,
    label: (status || 'PAID').toUpperCase(),
    badgeBg: '#DCFCE7',
    badgeBorder: '#A7F3D0',
    textColor: '#166534',
    reason: cleanReason,
  };
}

export interface PaymentStatusBadgeProps {
  status?: string | null;
  reason?: string | null;
  showReason?: boolean;
  badgeOnly?: boolean;
  compact?: boolean;
  showSuccess?: boolean;
  style?: StyleProp<ViewStyle>;
  badgeStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export default function PaymentStatusBadge({
  status,
  reason,
  showReason = true,
  badgeOnly = false,
  compact = false,
  showSuccess = false,
  style,
  badgeStyle,
  textStyle,
}: PaymentStatusBadgeProps) {
  const info = getPaymentStatusInfo(status, reason);

  // If normal successful and not explicitly requested, do not render extra badge
  if (!info.isFailed && !info.isPending && !showSuccess) {
    return null;
  }

  return (
    <View style={[styles.container, style]}>
      {/* Status Pill Badge */}
      <View
        style={[
          styles.badge,
          compact && styles.badgeCompact,
          {
            backgroundColor: info.badgeBg,
            borderColor: info.badgeBorder,
          },
          badgeStyle,
        ]}
      >
        <Ionicons
          name={
            info.isFailed
              ? 'close-circle'
              : info.isPending
              ? 'time'
              : 'checkmark-circle'
          }
          size={compact ? 10 : 12}
          color={info.textColor}
          style={styles.badgeIcon}
        />
        <Text
          style={[
            styles.badgeText,
            compact && styles.badgeTextCompact,
            { color: info.textColor },
            textStyle,
          ]}
        >
          {info.label}
        </Text>
      </View>

      {/* Reason Box (only shown for failed or pending when reason exists) */}
      {!badgeOnly && showReason && info.reason && (info.isFailed || info.isPending) && (
        <View
          style={[
            styles.reasonBox,
            info.isFailed ? styles.reasonBoxFailed : styles.reasonBoxPending,
          ]}
        >
          <Ionicons
            name={info.isFailed ? 'alert-circle-outline' : 'time-outline'}
            size={13}
            color={info.isFailed ? '#DC2626' : '#D97706'}
            style={styles.reasonIcon}
          />
          <Text
            style={[
              styles.reasonText,
              info.isFailed ? styles.reasonTextFailed : styles.reasonTextPending,
            ]}
            numberOfLines={2}
          >
            <Text style={styles.reasonPrefix}>Reason: </Text>
            {info.reason}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeCompact: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeIcon: {
    marginRight: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  badgeTextCompact: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  reasonBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 6,
    borderWidth: 1,
    borderLeftWidth: 3,
    width: '100%',
  },
  reasonBoxFailed: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FEE2E2',
    borderLeftColor: '#DC2626',
  },
  reasonBoxPending: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FEF3C7',
    borderLeftColor: '#D97706',
  },
  reasonIcon: {
    marginRight: 6,
    marginTop: 0.5,
  },
  reasonText: {
    fontSize: 11.5,
    fontWeight: '600',
    flex: 1,
  },
  reasonTextFailed: {
    color: '#991B1B',
  },
  reasonTextPending: {
    color: '#92400E',
  },
  reasonPrefix: {
    fontWeight: '700',
  },
});
