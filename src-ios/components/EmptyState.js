const React = require('react');
const { View, Text, StyleSheet } = require('react-native');
const { typography, colors, spacing } = require('../theme');

function EmptyState({ title, body }) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    alignItems: 'center',
  },
  title: {
    ...typography.title,
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    ...typography.subtitle,
    marginTop: spacing.md,
    textAlign: 'center',
    color: colors.mutedInk,
  },
});

module.exports = EmptyState;
