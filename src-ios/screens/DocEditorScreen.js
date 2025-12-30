const React = require('react');
const { View, Text, TextInput, StyleSheet, Pressable, Alert } = require('react-native');
const { useTranslation } = require('react-i18next');
const Screen = require('../components/Screen');
const EditorWebView = require('../components/EditorWebView');
const { createDoc, updateDoc, deleteDoc, loadDocContent } = require('../db/docs');
const { typography, spacing, colors } = require('../theme');

function DocEditorScreen({ navigation, route }) {
  const { t } = useTranslation();
  const { mode, doc } = route.params || { mode: 'create' };
  const [title, setTitle] = React.useState(doc?.name || '');
  const [content, setContent] = React.useState('');

  React.useEffect(() => {
    let mounted = true;
    if (doc) {
      loadDocContent(doc).then((text) => {
        if (mounted) {
          setContent(text || '');
        }
      });
    }
    return () => {
      mounted = false;
    };
  }, [doc]);

  const handleSave = async () => {
    if (mode === 'create') {
      await createDoc({ title, content });
    } else {
      await updateDoc({ id: doc.id, title, content });
    }
    navigation.goBack();
  };

  const handleDelete = async () => {
    if (mode !== 'edit') return;
    Alert.alert(t('common.delete'), t('common.delete'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteDoc(doc.id);
          navigation.goBack();
        },
      },
    ]);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.heading}>{t('docs.title')}</Text>
        <View style={styles.actions}>
          {mode === 'edit' ? (
            <Pressable onPress={handleDelete}>
              <Text style={styles.delete}>{t('common.delete')}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={handleSave}>
            <Text style={styles.save}>{t('common.save')}</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.editorCard}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={t('common.title')}
          style={styles.titleInput}
          placeholderTextColor={colors.mutedInk}
        />
        <EditorWebView docId={doc?.id || 'new-doc'} markdown={content} onChange={setContent} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  heading: {
    ...typography.title,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  save: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '600',
  },
  delete: {
    ...typography.body,
    color: '#b42318',
  },
  editorCard: {
    flex: 1,
  },
  titleInput: {
    ...typography.body,
    fontSize: 18,
    marginBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  contentInput: {
    ...typography.body,
    flex: 1,
    marginTop: spacing.sm,
  },
});

module.exports = DocEditorScreen;
