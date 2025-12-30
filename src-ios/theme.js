const colors = {
  paper: '#ffffff',
  ink: '#1f1e1b',
  mutedInk: '#6b7280',
  accent: '#e76f2c',
  border: '#e7e5e4',
  card: '#ffffff',
  shadow: '#000000',
  gradientA: '#ffffff',
  gradientB: '#ffffff',
  gradientC: '#ffffff',
};

const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
};

const typography = {
  title: {
    fontFamily: 'Georgia',
    fontSize: 24,
    fontWeight: '600',
    color: colors.ink,
  },
  subtitle: {
    fontFamily: 'Avenir',
    fontSize: 14,
    color: colors.mutedInk,
  },
  body: {
    fontFamily: 'Avenir',
    fontSize: 16,
    color: colors.ink,
  },
  label: {
    fontFamily: 'Avenir',
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.mutedInk,
  },
};

module.exports = {
  colors,
  spacing,
  typography,
};
