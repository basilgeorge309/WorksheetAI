// Scribbl design tokens — Editorial Notebook system (ruled paper, serif italic,
// ink fills, sharp corners, borders instead of shadows).
import { Platform } from 'react-native';

// Georgia on iOS; graceful serif fallback elsewhere.
const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' });

export const colors = {
  paper: '#FDFCF7', // warm off-white, like real paper
  paperLine: '#D4DCE8', // faint blue ruled lines
  marginRed: '#F0B8B8', // the red margin rule
  ink: '#1C1C1E', // primary text + fills, near-black
  graphite: '#6B6B70', // secondary text
  mutedText: '#9CA3AF',
  pencilYellow: '#F5C842',
  alertRed: '#C45050', // softer than pure red, ink-and-paper feel
  alertRedBg: '#FBEAEA',
  successGreen: '#3F8F5F', // muted, paper-appropriate green
  successGreenBg: '#E8F3EC',
  errorRed: '#C0392B',
  errorRedBg: '#FBEAEA',
  warningAmber: '#B8860B',
  warningAmberBg: '#FBF3DC',
  borderInk: '#1C1C1E', // sharp borders use ink, not soft gray
};

export const radius = {
  sharp: 2, // default — almost-square corners
  sm: 4,
  md: 6,
  pill: 999, // only for true pills (badges)
};

// No soft shadows in this system. Borders do the work instead.
export const border = {
  hairline: { borderWidth: 1, borderColor: colors.paperLine },
  rule: { borderWidth: 1.5, borderColor: colors.ink },
  dashed: { borderWidth: 1.5, borderColor: colors.ink, borderStyle: 'dashed' as const },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 36,
};

// Two type families: serif italic for personality/headlines, system sans for
// UI labels/data (keeps it readable, not twee).
export const type = {
  displaySerif: {
    fontFamily: serif,
    fontSize: 28,
    fontWeight: '700' as const,
    fontStyle: 'italic' as const,
  },
  titleSerif: {
    fontFamily: serif,
    fontSize: 20,
    fontWeight: '700' as const,
    fontStyle: 'italic' as const,
  },
  bodySerif: { fontFamily: serif, fontSize: 16, fontStyle: 'italic' as const },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },
  body: { fontSize: 15, fontWeight: '400' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
};
