import { apiClient } from './apiClient';
import { ActiveShiftData, shiftService } from './shiftService';
import { tokenStorage } from './tokenStorage';
import type { UserProfile } from '../context/AuthContext';
import { mapBackendUserType, getRoleLabel } from './authService';

export interface DashboardHeader {
  title?: string;
  business_name?: string;
  logo_url?: string | null;
  banner_image_url?: string | null;
  abn?: string;
  phone?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  taxi_no?: string | null;
  identifier_type?: string;
  identifier_value?: string;
  identifier_label?: string;
  shift_start_label?: string | null;
  active_shift_code?: string | null;
  active_shift_label?: string;
  shift_badge_text?: string;
  shift_badge_variant?: string;
}

export interface DashboardSaleButton {
  is_visible?: boolean;
}

export interface RevenueBreakdown {
  amount: number;
  amount_formatted: string;
  count: number;
  count_formatted?: string;
}

export interface DashboardRevenue {
  timeframe: string;
  timeframe_label: string;
  unit: string;
  total_amount: number;
  total_amount_formatted: string;
  total_count: number;
  total_count_formatted?: string;
  card: RevenueBreakdown;
  tap_and_go: RevenueBreakdown;
}

export interface ActiveEmployeesSummary {
  total_count: number;
  on_shift_count: number;
  off_shift_count: number;
  total_label?: string;
  on_shift_label?: string;
  off_shift_label?: string;
}

export interface EmployeeShiftsSummary {
  paid: number;
  unpaid: number;
  paid_label?: string;
  unpaid_label?: string;
}

export interface ActiveEmployeeItem {
  id: number | string;
  name: string;
  first_name?: string;
  last_name?: string;
  initials?: string;
  emp_id: string;
  emp_id_label?: string;
  profile_photo_url?: string | null;
  is_online?: boolean;
  online_badge?: string;
  is_on_shift?: boolean;
  active_shift_revenue: number;
  active_shift_revenue_formatted: string;
  shifts: EmployeeShiftsSummary;
}

export interface ActiveEmployeesSection {
  summary: ActiveEmployeesSummary;
  list: ActiveEmployeeItem[];
}

export interface ActiveDriverItem {
  id: number | string;
  name: string;
  first_name?: string;
  last_name?: string;
  initials?: string;
  taxi_no?: string;
  dc_number?: string;
  profile_photo_url?: string | null;
  is_online?: boolean;
  online_badge?: string;
  is_on_shift?: boolean;
  active_shift_revenue: number;
  active_shift_revenue_formatted: string;
  shifts: {
    paid: number;
    unpaid: number;
  };
}

export interface ActiveDriversSummary {
  total_count: number;
  on_shift_count: number;
  off_shift_count: number;
}

export interface ActiveDriversSection {
  summary: ActiveDriversSummary;
  list: ActiveDriverItem[];
}

export interface RecentTransactionReceiptBreakdown {
  payable_amount?: number;
  base_amount?: number;
  service_fee?: number;
}

export interface RecentTransactionReceipt {
  business_name?: string;
  business_logo?: string | null;
  abn?: string;
  phone_no?: string;
  phone?: string;
  address?: string;
  employee_id?: string;
  amount?: number;
  amount_formatted?: string;
  payment_status?: string;
  reason?: string | null;
  date_time?: string;
  payment_method?: string;
  payment_type?: string;
  card_brand?: string | null;
  payment_id?: string;
  ad_banner?: boolean;
  banner_image_url?: string | null;
  payment_break_down?: RecentTransactionReceiptBreakdown;
  taxi_number?: string;
  dc_number?: string;
  pickup_location?: string;
  drop_location?: string;
}

export interface RecentTransactionItem {
  id: number | string;
  txn_id?: string;
  transaction_id?: string;
  amount: number;
  amount_formatted: string;
  payment_method?: string;
  payment_method_label?: string;
  created_at?: string;
  date?: string;
  date_formatted?: string;
  time?: string;
  time_formatted?: string;
  status?: string;
  payment_status?: string;
  reason?: string | null;
  pickup?: string;
  dropoff?: string;
  pickup_location?: string;
  dropoff_location?: string;
  drop_location?: string | null;
  route?: {
    pickup?: string;
    dropoff?: string;
  };
  receipt?: RecentTransactionReceipt;
}

export interface RecentTransactionsSection {
  title?: string;
  action?: string;
  count: number;
  list: RecentTransactionItem[];
}

export type RecentTripsSection = RecentTransactionsSection;

export interface AllowedPaymentMethod {
  id: number;
  method_name: string;
}

export interface DashboardData {
  user_type_key: string;
  role_id: number;
  is_taxi_service: boolean;
  is_on_shift: boolean;
  taxi_no?: string | null;
  start_time?: string | null;
  start_at?: string | null;
  active_shift?: ActiveShiftData | null;
  active_shift_text?: string;
  shift_status_badge?: string;
  header: DashboardHeader;
  allowed_payment_method?: AllowedPaymentMethod[];
  sale_button?: DashboardSaleButton;
  revenue: DashboardRevenue;
  section_type: string;
  active_employees?: ActiveEmployeesSection;
  active_drivers?: ActiveDriversSection;
  recent_transactions?: RecentTransactionsSection;
  recent_trips?: RecentTripsSection;
}

export interface DashboardResponse {
  status: boolean;
  message: string;
  data: DashboardData;
}

export interface DashboardSyncData {
  user_type_key?: string;
  role_id?: number;
  is_taxi_service?: boolean;
  header: DashboardHeader;
}

export type DashboardSyncCallback = (data: DashboardSyncData) => void;
export type DashboardHeaderSyncCallback = (header: DashboardHeader) => void;
let dashboardSyncListeners: DashboardSyncCallback[] = [];
let headerSyncListeners: DashboardHeaderSyncCallback[] = [];
let activeDashboardPromise: Promise<DashboardResponse> | null = null;
let cachedDashboardHeader: DashboardHeader | null = null;
let cachedDashboardData: DashboardData | null = null;

export function getCachedDashboardHeader(): DashboardHeader | null {
  return cachedDashboardHeader;
}

export function getCachedDashboardData(): DashboardData | null {
  return cachedDashboardData;
}

export function clearDashboardCache(): void {
  cachedDashboardHeader = null;
  cachedDashboardData = null;
}

/**
 * Listen to unified dashboard sync updates (role, permissions, header)
 */
export function onDashboardSync(callback: DashboardSyncCallback): () => void {
  dashboardSyncListeners.push(callback);
  if (cachedDashboardData) {
    try {
      callback({
        user_type_key: cachedDashboardData.user_type_key,
        role_id: cachedDashboardData.role_id,
        is_taxi_service: cachedDashboardData.is_taxi_service,
        header: cachedDashboardData.header || {},
      });
    } catch (err) {
      console.warn('⚠️ Error in initial dashboard sync callback:', err);
    }
  }
  return () => {
    dashboardSyncListeners = dashboardSyncListeners.filter((cb) => cb !== callback);
  };
}

/**
 * Returns current active shift session ID for payments, or null if off-shift.
 */
export async function getActiveShiftSessionId(): Promise<number | null> {
  const activeShift = shiftService.getActiveShift();
  if (activeShift?.id) return activeShift.id;
  if (cachedDashboardData?.active_shift?.id) return cachedDashboardData.active_shift.id;

  try {
    const dash = await dashboardService.getDashboard();
    if (dash?.data?.active_shift?.id) {
      return dash.data.active_shift.id;
    }
  } catch {}

  return null;
}

export type AllowedPaymentMethodsCallback = (methods: AllowedPaymentMethod[]) => void;
let allowedMethodsListeners: AllowedPaymentMethodsCallback[] = [];

export function getAllowedPaymentMethods(): AllowedPaymentMethod[] | null {
  return cachedDashboardData?.allowed_payment_method || tokenStorage.getAllowedPaymentMethods();
}

export function onAllowedPaymentMethodsChange(callback: AllowedPaymentMethodsCallback): () => void {
  allowedMethodsListeners.push(callback);
  const current = getAllowedPaymentMethods();
  if (current) {
    try {
      callback(current);
    } catch (err) {
      console.warn('⚠️ Error in initial allowed payment methods callback:', err);
    }
  }
  return () => {
    allowedMethodsListeners = allowedMethodsListeners.filter((cb) => cb !== callback);
  };
}

function notifyAllowedPaymentMethodsChange(methods: AllowedPaymentMethod[]) {
  allowedMethodsListeners.forEach((listener) => {
    try {
      listener(methods);
    } catch (err) {
      console.warn('⚠️ Error in allowed payment methods listener:', err);
    }
  });
}

export function onDashboardHeaderSync(callback: DashboardHeaderSyncCallback): () => void {
  headerSyncListeners.push(callback);
  if (cachedDashboardHeader) {
    try {
      callback(cachedDashboardHeader);
    } catch (err) {
      console.warn('⚠️ Error in initial dashboard header callback:', err);
    }
  }
  return () => {
    headerSyncListeners = headerSyncListeners.filter((cb) => cb !== callback);
  };
}

/**
 * Dashboard API Service
 */
export const dashboardService = {
  /**
   * GET /api/user/dashboard
   * Fetches unified dashboard metrics, shift status, and employee/driver lists
   */
  getDashboard: async (): Promise<DashboardResponse> => {
    if (activeDashboardPromise) {
      return activeDashboardPromise;
    }

    activeDashboardPromise = (async () => {
      try {
        const response = await apiClient.get<DashboardResponse>('/api/user/dashboard');
        const resData = response.data;

        if (resData?.data) {
          cachedDashboardData = resData.data;
          const { user_type_key, role_id, is_taxi_service, header: h } = resData.data;

          if (resData.data.active_shift) {
            shiftService.setActiveShift(resData.data.active_shift);
          } else if (resData.data.is_on_shift === false) {
            shiftService.setActiveShift(null);
          }

          if (resData.data.allowed_payment_method) {
            tokenStorage.saveAllowedPaymentMethods(resData.data.allowed_payment_method);
            notifyAllowedPaymentMethodsChange(resData.data.allowed_payment_method);
          }

          if (h) {
            cachedDashboardHeader = h;
          }

          // 1. Persist resolved user role, taxi settings, and header details to stored session on device
          tokenStorage
            .loadStoredSession()
            .then(({ user }) => {
              if (user) {
                const detectedLoginType = user_type_key
                  ? mapBackendUserType(user_type_key)
                  : user.loginType;

                const resolvedTaxiNumber =
                  h?.taxi_no !== undefined
                    ? (h?.taxi_no || user.taxiNumber)
                    : h?.identifier_type === 'taxi_no' && h?.identifier_value
                    ? h?.identifier_value
                    : user.taxiNumber;

                const updated: UserProfile = {
                  ...user,
                  userTypeKey: user_type_key || user.userTypeKey,
                  loginType: detectedLoginType,
                  roleLabel: getRoleLabel(detectedLoginType) || user.roleLabel,
                  isTaxiService: is_taxi_service ?? user.isTaxiService,
                  roleId: role_id ?? user.roleId,
                  name: h?.full_name || user.name,
                  abn: h?.abn || user.abn,
                  phone: h?.phone || user.phone,
                  businessName: h?.business_name || user.businessName,
                  empId: h?.identifier_value || user.empId,
                  taxiNumber: resolvedTaxiNumber,
                  logoUrl: h?.logo_url !== undefined ? h?.logo_url : user.logoUrl,
                  bannerImageUrl:
                    h?.banner_image_url !== undefined ? h?.banner_image_url : user.bannerImageUrl,
                };
                tokenStorage.saveUser(updated);
              }
            })
            .catch(() => {});

          // 2. Notify dashboard sync listeners (AuthContext, etc.)
          const syncPayload: DashboardSyncData = {
            user_type_key,
            role_id,
            is_taxi_service,
            header: h || {},
          };
          dashboardSyncListeners.forEach((listener) => {
            try {
              listener(syncPayload);
            } catch (err) {
              console.warn('⚠️ Error in dashboard sync listener:', err);
            }
          });

          // 3. Notify legacy header listeners
          if (h) {
            headerSyncListeners.forEach((listener) => {
              try {
                listener(h);
              } catch (err) {
                console.warn('⚠️ Error in dashboard header listener:', err);
              }
            });
          }
        }

        return response.data;
      } finally {
        activeDashboardPromise = null;
      }
    })();

    return activeDashboardPromise;
  },
};
