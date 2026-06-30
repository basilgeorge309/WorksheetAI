import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';

import { colors } from '../constants/theme';

const { width } = Dimensions.get('window');
const CONFETTI_COLORS = [colors.pencilYellow, colors.alertRed, colors.ink];
const PIECE_COUNT = 16;

type Piece = {
  x: number;
  delay: number;
  color: string;
  shape: 'square' | 'circle';
  size: number;
  rotation: number;
  fall: number; // precomputed so re-renders don't jitter
  drift: number;
  duration: number;
};

const pieces: Piece[] = Array.from({ length: PIECE_COUNT }, (_, i) => ({
  x: Math.random() * width,
  delay: Math.random() * 150,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  shape: Math.random() > 0.5 ? 'square' : 'circle',
  size: 6 + Math.random() * 4,
  rotation: Math.random() * 360,
  fall: 400 + Math.random() * 200,
  drift: (Math.random() - 0.5) * 100,
  duration: 1200 + Math.random() * 400,
}));

export default function Confetti({ trigger }: { trigger: boolean }) {
  const animValues = useRef(pieces.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (trigger) {
      const animations = animValues.map((anim, i) =>
        Animated.timing(anim, {
          toValue: 1,
          duration: pieces[i].duration,
          delay: pieces[i].delay,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        })
      );
      Animated.stagger(20, animations).start();
    }
  }, [trigger, animValues]);

  if (!trigger) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((piece, i) => {
        const translateY = animValues[i].interpolate({
          inputRange: [0, 1],
          outputRange: [0, piece.fall],
        });
        const translateX = animValues[i].interpolate({
          inputRange: [0, 1],
          outputRange: [0, piece.drift],
        });
        const opacity = animValues[i].interpolate({
          inputRange: [0, 0.8, 1],
          outputRange: [1, 1, 0],
        });
        const rotate = animValues[i].interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${piece.rotation + 360}deg`],
        });

        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: piece.x,
              top: 60,
              width: piece.size,
              height: piece.size,
              backgroundColor: piece.color,
              borderRadius: piece.shape === 'circle' ? piece.size / 2 : 2,
              opacity,
              transform: [{ translateY }, { translateX }, { rotate }],
            }}
          />
        );
      })}
    </View>
  );
}
