import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, Animated, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface LiveBadgeProps {
  label?: string;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}

export default function LiveBadge({ label = 'LIVE', size = 'sm', style }: LiveBadgeProps) {
  const [pulseAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 1600,
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  const scale = useMemo(
    () =>
      pulseAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 2.5],
      }),
    [pulseAnim]
  );

  const opacity = useMemo(
    () =>
      pulseAnim.interpolate({
        inputRange: [0, 0.6, 1],
        outputRange: [0.75, 0.25, 0],
      }),
    [pulseAnim]
  );

  const isMd = size === 'md';

  return (
    <View style={[styles.badge, isMd && styles.badgeMd, style]}>
      <View style={styles.dotContainer}>
        <Animated.View
          style={[
            styles.pulseRing,
            {
              transform: [{ scale }],
              opacity,
            },
          ]}
        />
        <View style={styles.dot} />
      </View>
      <Ionicons
        name="radio"
        size={isMd ? 12 : 10.5}
        color="#059669"
        style={styles.icon}
      />
      <Text style={[styles.text, isMd && styles.textMd]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 6.5,
    paddingVertical: 2.5,
    borderRadius: 12,
  },
  badgeMd: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 14,
  },
  dotContainer: {
    width: 8,
    height: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 3,
  },
  pulseRing: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  dot: {
    width: 5.5,
    height: 5.5,
    borderRadius: 2.75,
    backgroundColor: '#10B981',
  },
  icon: {
    marginRight: 2.5,
  },
  text: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#047857',
    letterSpacing: 0.5,
  },
  textMd: {
    fontSize: 11,
  },
});
