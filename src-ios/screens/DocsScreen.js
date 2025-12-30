const React = require('react');
const { View, Text, StyleSheet, FlatList } = require('react-native');
const { useTranslation } = require('react-i18next');
const Screen = require('../components/Screen');
const Card = require('../components/Card');
const EmptyState = require('../components/EmptyState');
const FadeInView = require('../components/FadeInView');
const { listDocs } = require('../db/docs');
const { typography, spacing, colors } = require('../theme');
const { formatDate } = require('../utils/date');

function DocsScreen({ navigation }) {
  const { t, i18n } = useTranslation();
  const [docs, setDocs] = React.useState([]);

  const loadDocs = React.useCallback(async () => {
    const data = await listDocs();
    setDocs(data);
  }, []);

  React.useEffect(() => {
    const unsubscribe = navigation.addListener('focus', loadDocs);
    return unsubscribe;
  }, [navigation, loadDocs]);

  const renderItem = ({ item }) => (
    <Card style={styles.card}>
      <Text style={styles.title}>{item.name}</Text>
      <Text style={styles.preview} numberOfLines={2}>
        {item.description || t('docs.emptyBody')}
      </Text>
      <Text style={styles.meta}>{formatDate(item.updated_at, i18n.language)}</Text>
    </Card>
  );

  return (
    <Screen>
      <FadeInView style={styles.header}>
        <Text style={styles.heading}>{t('docs.title')}</Text>
        {docs.length > 0 ? <Text style={styles.subhead}>{t('docs.emptyBody')}</Text> : null}
      </FadeInView>
      <View style={styles.listWrapper}>
        {docs.length === 0 ? (
          <EmptyState title={t('docs.emptyTitle')} body={t('docs.comingSoon')} />
        ) : (
          <FlatList
            data={docs}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.md,
  },
  heading: {
    ...typography.title,
    fontSize: 28,
    fontWeight: '700',
  },
  subhead: {
    ...typography.subtitle,
    marginTop: spacing.xs,
  },
  listWrapper: {
    flex: 1,
  },
  list: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  card: {
    marginBottom: spacing.md,
  },
  title: {
    ...typography.body,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  preview: {
    ...typography.subtitle,
    color: colors.mutedInk,
  },
  meta: {
    ...typography.label,
    marginTop: spacing.sm,
  },
});

module.exports = DocsScreen;
