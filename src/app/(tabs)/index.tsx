import React, { useMemo } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { mapBackendUserType } from '../../services/authService';
import { getCachedDashboardData } from '../../services/dashboardService';
import {
  TaxiOwnerDashboard,
  TaxiBusinessDashboard,
  TaxiDriverDashboard,
} from '../../components/taxi';
import {
  OtherBusinessDashboard,
  OtherBusinessEmployeeDashboard,
} from '../../components/other-business';

export default function DashboardScreen() {
  const { user } = useAuth();
  const cachedDash = getCachedDashboardData();

  // Role resolution strictly using user_type_key from dashboard response or user session
  const effectiveLoginType = useMemo(() => {
    if (cachedDash?.user_type_key) {
      return mapBackendUserType(cachedDash.user_type_key);
    }
    return user.loginType;
  }, [user.loginType, cachedDash?.user_type_key]);

  // Role 1: Taxi Owner (Lovedeep Khangura)
  if (effectiveLoginType === 'taxi_owner') {
    return (
      <TaxiOwnerDashboard
        businessName={user.businessName}
        userName={user.name}
        taxiNumber={user.taxiNumber}
        sessionStartTime={user.sessionStartTime}
      />
    );
  }

  // Role 2: Taxi Fleet Business Admin (Lovedeep Khangura - Fleet Admin)
  if (effectiveLoginType === 'taxi_business') {
    return (
      <TaxiBusinessDashboard
        businessName={user.businessName}
        userName={user.name}
        taxiNumber={user.taxiNumber}
        sessionStartTime={user.sessionStartTime}
      />
    );
  }

  // Role 3: Taxi Business Driver (Gurpreet Singh)
  if (effectiveLoginType === 'taxi_business_driver') {
    return (
      <TaxiDriverDashboard
        businessName={user.businessName}
        userName={user.name}
        taxiNumber={user.taxiNumber}
        sessionStartTime={user.sessionStartTime}
      />
    );
  }

  // Role 5: Other Business Employee (Liam Hemsworth)
  if (effectiveLoginType === 'other_business_employee') {
    return (
      <OtherBusinessEmployeeDashboard
        businessName={user.businessName}
        businessAddress={user.businessAddress}
        userName={user.name}
        sessionStartTime={user.sessionStartTime}
        empId={user.empId || ''}
      />
    );
  }

  // Role 4: Other Business Owner (Merchant)
  if (effectiveLoginType === 'other_business') {
    return (
      <OtherBusinessDashboard
        businessName={user.businessName}
        businessAddress={user.businessAddress}
        userName={user.name}
        sessionStartTime={user.sessionStartTime}
        empId={user.empId}
      />
    );
  }

  // Clean empty state while role is resolving (zero fake fallback dashboard)
  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#D97706" />
    </View>
  );
}
