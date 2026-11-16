import React from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { OtherBusinessShiftDetailsScreen } from '../../components/other-business/owner';
import { useAuth } from '../../context/AuthContext';

export default function TabShiftDetailsRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ shiftId?: string }>();
  const { user } = useAuth();

  return (
    <OtherBusinessShiftDetailsScreen
      shiftId={params.shiftId || ''}
      onBack={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/(tabs)/transactions');
        }
      }}
      businessName={user.businessName}
      userName={user.name}
    />
  );
}
