import React, { useEffect, useMemo } from 'react';
import { BackHandler, View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { mapBackendUserType } from '../../services/authService';
import { getCachedDashboardData } from '../../services/dashboardService';
import {
  TaxiBusinessHistoryScreen,
  TaxiDriverHistoryScreen,
  TaxiOwnerHistoryScreen,
} from '../../components/taxi';
import {
  OtherBusinessTransactionsScreen,
  OtherBusinessShiftDetailsScreen,
  OtherBusinessEmployeeHistoryScreen,
} from '../../components/other-business';
import { ShiftRecordItem } from '../../services/shiftService';

export default function TransactionsTabScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ shiftId?: string; empId?: string; driverId?: string }>();
  const { user } = useAuth();
  const cachedDash = getCachedDashboardData();

  // Role resolution strictly using user_type_key from dashboard response or user session
  const effectiveLoginType = useMemo(() => {
    if (cachedDash?.user_type_key) {
      return mapBackendUserType(cachedDash.user_type_key);
    }
    return user.loginType;
  }, [user.loginType, cachedDash?.user_type_key]);

  // Reset shift details / selection when user taps the History tab in the bottom bar
  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress' as any, () => {
      if (params.shiftId) {
        router.setParams({ shiftId: '' });
      }
    });
    return unsubscribe;
  }, [navigation, router, params.shiftId]);

  // Handle hardware back button on Android (called unconditionally)
  useEffect(() => {
    const backAction = () => {
      if (params.shiftId) {
        router.setParams({ shiftId: '' });
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [params.shiftId, router]);

  const handleSelectShift = (shift: ShiftRecordItem | any) => {
    const id = shift?.id ?? shift?.shift_id;
    if (id) {
      router.setParams({ shiftId: String(id) });
    }
  };

  const handleBackToHistory = () => {
    router.setParams({ shiftId: '' });
  };

  const handleEmployeeChange = (empId: string | null) => {
    router.setParams({ empId: empId || '' });
  };

  const handleDriverChange = (driverId: string | null) => {
    router.setParams({ driverId: driverId || '' });
  };

  // If a shift is selected, display live shift details
  if (params.shiftId) {
    return (
      <OtherBusinessShiftDetailsScreen
        shiftId={params.shiftId}
        onBack={handleBackToHistory}
        businessName={user.businessName}
        userName={user.name}
      />
    );
  }

  // Role: Taxi Owner
  if (effectiveLoginType === 'taxi_owner') {
    return (
      <TaxiOwnerHistoryScreen
        onSelectShift={handleSelectShift}
        taxiNumber={user.taxiNumber || ''}
      />
    );
  }

  // Role: Taxi Business Company / Fleet Admin
  if (effectiveLoginType === 'taxi_business') {
    return (
      <TaxiBusinessHistoryScreen
        onSelectShift={handleSelectShift}
        taxiNumber={user.taxiNumber}
        initialDriverId={params.driverId || params.empId}
        onDriverChange={handleDriverChange}
      />
    );
  }

  // Role 5: Other Business Employee - Dedicated Employee Shift History
  if (effectiveLoginType === 'other_business_employee') {
    return (
      <OtherBusinessEmployeeHistoryScreen
        userName={user.name}
        empId={user.empId || ''}
        onSelectShift={handleSelectShift}
      />
    );
  }

  // Role: Taxi Driver
  if (effectiveLoginType === 'taxi_business_driver') {
    return (
      <TaxiDriverHistoryScreen
        onSelectShift={handleSelectShift}
        taxiNumber={user.taxiNumber || ''}
      />
    );
  }

  // Role 4: Other Business Owner (Merchant)
  if (effectiveLoginType === 'other_business') {
    return (
      <OtherBusinessTransactionsScreen
        businessName={user.businessName}
        userName={user.name}
        initialEmpId={params.empId}
        onSelectShift={handleSelectShift}
        onEmployeeChange={handleEmployeeChange}
      />
    );
  }

  // Clean empty state while role is resolving
  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#D97706" />
    </View>
  );
}
