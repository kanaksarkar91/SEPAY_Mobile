import React, { useMemo } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { mapBackendUserType } from '../../services/authService';
import { getCachedDashboardData } from '../../services/dashboardService';
import {
  TaxiOwnerProfileScreen,
  TaxiBusinessProfileScreen,
  TaxiDriverProfileScreen,
} from '../../components/taxi';
import {
  OtherBusinessProfileScreen,
  OtherBusinessEmployeeProfileScreen,
} from '../../components/other-business';

export default function ProfileTabScreen() {
  const { user } = useAuth();
  const cachedDash = getCachedDashboardData();

  // Role resolution strictly using user_type_key from dashboard response or user session
  const effectiveLoginType = useMemo(() => {
    if (cachedDash?.user_type_key) {
      return mapBackendUserType(cachedDash.user_type_key);
    }
    return user.loginType;
  }, [user.loginType, cachedDash?.user_type_key]);

  // Role 1: Taxi Owner
  if (effectiveLoginType === 'taxi_owner') {
    return <TaxiOwnerProfileScreen />;
  }

  // Role 2: Taxi Business (Fleet Admin)
  if (effectiveLoginType === 'taxi_business') {
    return <TaxiBusinessProfileScreen />;
  }

  // Role 3: Taxi Business Driver
  if (effectiveLoginType === 'taxi_business_driver') {
    return <TaxiDriverProfileScreen />;
  }

  // Role 5: Other Business Employee
  if (effectiveLoginType === 'other_business_employee') {
    return <OtherBusinessEmployeeProfileScreen />;
  }

  // Role 4: Other Business Merchant Owner
  if (effectiveLoginType === 'other_business') {
    return <OtherBusinessProfileScreen />;
  }

  // Clean empty state while role is resolving
  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#D97706" />
    </View>
  );
}
