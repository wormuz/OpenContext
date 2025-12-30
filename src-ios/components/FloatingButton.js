const React = require('react');
const { Pressable, StyleSheet, Text } = require('react-native');
const { colors } = require('../theme');

function FloatingButton({ onPress, label }) {
  return (
    <Pressable onPress={onPress} style={styles.button}>
      <Text style={styles.label}>+</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 20,
    bottom: 30,
    backgroundColor: colors.accent,
    borderRadius: 24,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  label: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '500',
    marginTop: -2,
  },
});

module.exports = FloatingButton;
