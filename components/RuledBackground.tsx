import { Dimensions, StyleSheet } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { colors } from '../constants/theme';

const { width, height } = Dimensions.get('window');
const LINE_SPACING = 36;
export const MARGIN_X = 50;

export default function RuledBackground() {
  const lines = [];
  for (let y = 100; y < height; y += LINE_SPACING) {
    lines.push(
      <Line
        key={y}
        x1="0"
        y1={y}
        x2={width}
        y2={y}
        stroke={colors.paperLine}
        strokeWidth="1"
      />
    );
  }
  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height} pointerEvents="none">
      {lines}
      <Line
        x1={MARGIN_X}
        y1="0"
        x2={MARGIN_X}
        y2={height}
        stroke={colors.marginRed}
        strokeWidth="1.5"
      />
    </Svg>
  );
}
