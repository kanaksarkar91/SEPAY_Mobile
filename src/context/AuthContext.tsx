import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { router } from 'expo-router';
import { authService } from '../services/authService';
import { tokenStorage } from '../services/tokenStorage';
import { deviceService } from '../services/deviceService';
import { onUnauthorized, resetUnauthorizedHandling } from '../services/apiClient';
import { onDashboardHeaderSync, dashboardService } from '../services/dashboardService';
import { APP_CONFIG } from '../constants/appConfig';

export type LoginType =
  | 'taxi_owner'
  | 'taxi_business'
  | 'taxi_business_driver'
  | 'other_business'
  | 'other_business_employee';

export interface UserProfile {
  id: string;
  username: string;
  name: string;
  loginType: LoginType;
  roleLabel: string;
  businessName: string;
  businessAddress?: string;
  taxiNumber?: string;
  empId?: string;
  sessionStartTime: string;
  abn?: string;
  phone?: string;
  logoUrl?: string | null;
  bannerImageUrl?: string | null;
}

export const EMPTY_USER: UserProfile = {
  id: '',
  username: '',
  name: '',
  loginType: 'other_business',
  roleLabel: '',
  businessName: '',
  businessAddress: '',
  taxiNumber: '',
  empId: '',
  sessionStartTime: '',
  abn: '',
  phone: '',
  logoUrl: null,
  bannerImageUrl: null,
};

interface AuthContextType {
  user: UserProfile;
  isAuthenticated: boolean;
  isInitializing: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateUserProfile: (partial: Partial<UserProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile>(EMPTY_USER);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  // Auto-sync dashboard header parameters (abn, phone, businessName, empId, logoUrl) to user state & storage
  useEffect(() => {
    const unsubscribe = onDashboardHeaderSync((header) => {
      setUser((prev) => {
        const hasChanged =
          (Boolean(header.abn) && prev.abn !== header.abn) ||
          (Boolean(header.phone) && prev.phone !== header.phone) ||
          (Boolean(header.business_name) && prev.businessName !== header.business_name) ||
          (Boolean(header.identifier_value) && prev.empId !== header.identifier_value) ||
          (header.logo_url !== undefined && prev.logoUrl !== header.logo_url) ||
          (header.banner_image_url !== undefined && prev.bannerImageUrl !== header.banner_image_url);

        if (!hasChanged) {
          return prev;
        }

        const next: UserProfile = {
          ...prev,
          abn: header.abn || prev.abn,
          phone: header.phone || prev.phone,
          businessName: header.business_name || prev.businessName,
          empId: header.identifier_value || prev.empId,
          logoUrl: header.logo_url !== undefined ? header.logo_url : prev.logoUrl,
          bannerImageUrl:
            header.banner_image_url !== undefined ? header.banner_image_url : prev.bannerImageUrl,
        };
        tokenStorage.saveUser(next);
        return next;
      });
    });

    return () => unsubscribe();
  }, []);

  // Restore encrypted session on cold start
  useEffect(() => {
    async function restoreSession() {
      try {
        // Pre-warm device ID in background
        deviceService.getDeviceId().catch(() => {});

        const { user: storedUser, accessToken } = await tokenStorage.loadStoredSession();
        if (storedUser && accessToken) {
          setUser(storedUser);
          setIsAuthenticated(true);
          console.log('🔐 [AuthContext] Restored encrypted user session:', storedUser.name);
          dashboardService.getDashboard().catch(() => {});
        }
      } catch (err) {
        console.warn('⚠️ [AuthContext] Could not restore session from storage:', err);
      } finally {
        setIsInitializing(false);
      }
    }

    restoreSession();
  }, []);

  // Listen for 401 Unauthorized from backend (e.g. single login kicked out from another device)
  useEffect(() => {
    const unsub = onUnauthorized(async (reason) => {
      console.warn('🔒 [AuthContext] 401 Unauthorized received. Logging out and redirecting to login:', reason);
      setIsAuthenticated(false);
      setUser(EMPTY_USER);
      await authService.logout().catch(() => {});
      try {
        router.replace({
          pathname: '/login',
          params: {
            sessionExpired: '1',
            reason: reason || 'Session expired or logged in from another device. Please sign in again.',
          },
        });
      } catch (navErr) {
        console.warn('⚠️ [AuthContext] Navigation to login on 401 failed:', navErr);
      }
    });

    return () => unsub();
  }, []);

  const login = async (
    inputUsername: string,
    inputPassword: string
  ): Promise<{ success: boolean; error?: string }> => {
    const trimmedUser = inputUsername.trim();
    const trimmedPass = inputPassword.trim();

    try {
      resetUnauthorizedHandling();
      const deviceId = await deviceService.getDeviceId();
      const platform = deviceService.getPlatform();

      const liveUser = await authService.login({
        username: trimmedUser,
        password: trimmedPass,
        deviceInfo: {
          platform,
          deviceId,
          appVersion: APP_CONFIG.version,
        },
      });
      setUser(liveUser);
      setIsAuthenticated(true);
      await tokenStorage.saveUser(liveUser);
      dashboardService.getDashboard().catch(() => {});
      return { success: true };
    } catch (apiErr: any) {
      console.log('Live login attempt failed:', apiErr.message || apiErr);
      return {
        success: false,
        error: apiErr?.message || 'Invalid username or password.',
      };
    }
  };

  const updateUserProfile = useCallback(async (partial: Partial<UserProfile>) => {
    setUser((prev) => {
      const updated: UserProfile = { ...prev, ...partial };
      tokenStorage.saveUser(updated);
      return updated;
    });
  }, []);

  const logout = async () => {
    resetUnauthorizedHandling();
    setIsAuthenticated(false);
    setUser(EMPTY_USER);
    await authService.logout();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isInitializing,
        login,
        logout,
        updateUserProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
