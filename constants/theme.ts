// Scribbl design tokens — Notebook v2 (cleaner): left-margin accent instead of a
// ruled grid, soft warm card borders, radius.md default, depth on primary buttons.
import { Platform } from 'react-native';

export const colors = {
  paper: '#FDFCF7',
  marginRed: '#E8B4B4', // left accent border, not a background grid
  ink: '#1C1C1E',
  graphite: '#6B6B70',
  mutedText: '#9CA3AF',
  pencilYellow: '#F5C842',
  alertRed: '#C45050',
  alertRedBg: '#FBEAEA',
  successGreen: '#3F8F5F',
  successGreenBg: '#E8F3EC',
  errorRed: '#C0392B',
  errorRedBg: '#FBEAEA',
  warningAmber: '#B8860B',
  warningAmberBg: '#FBF3DC',
  borderInk: '#1C1C1E',
  cardBorder: '#E5E1D5', // soft warm border for non-selected cards
};

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  pill: 999,
};

export const border = {
  hairline: { borderWidth: 1, borderColor: colors.cardBorder },
  rule: { borderWidth: 1.5, borderColor: colors.ink },
};

export const shadow = {
  button: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 6,
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 32,
};

const serifFont = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' });

export const type = {
  displaySerif: {
    fontFamily: serifFont,
    fontSize: 30,
    fontWeight: '700' as const,
    fontStyle: 'italic' as const,
  },
  titleSerif: {
    fontFamily: serifFont,
    fontSize: 20,
    fontWeight: '700' as const,
    fontStyle: 'italic' as const,
  },
  bodySerif: { fontFamily: serifFont, fontSize: 16, fontStyle: 'italic' as const },
  buttonSerif: { fontFamily: serifFont, fontSize: 17, fontStyle: 'italic' as const },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
  body: { fontSize: 15, fontWeight: '400' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
};
