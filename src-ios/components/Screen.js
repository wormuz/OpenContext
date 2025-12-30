const React = require('react');
const { SafeAreaView, View, StyleSheet } = require('react-native');
const { LinearGradient } = require('expo-linear-gradient');
const { colors, spacing } = require('../theme');

function Screen({ children }) {
  return (
    <LinearGradient
      colors={[colors.gradientA, colors.gradientB, colors.gradientC]}
      style={styles.root}
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.inner}>{children}</View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  inner: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
});

module.exports = Screen;
