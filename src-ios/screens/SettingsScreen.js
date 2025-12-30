const React = require('react');
const {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Alert,
} = require('react-native');
const { useTranslation } = require('react-i18next');
const { useFocusEffect } = require('@react-navigation/native');
const Screen = require('../components/Screen');
const Card = require('../components/Card');
const { setLanguage, getLanguage } = require('../i18n');
const { loadAIConfig, saveAIConfig } = require('../services/ai');
const { typography, spacing, colors } = require('../theme');

function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const [lang, setLang] = React.useState(i18n.language);
  const [aiConfig, setAiConfig] = React.useState({
    apiBase: '',
    model: '',
    apiKey: '',
    prompt: '',
  });
  const [isEditingAI, setIsEditingAI] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveStatus, setSaveStatus] = React.useState('idle');
  const saveTimeoutRef = React.useRef(null);

  React.useEffect(() => {
    getLanguage().then((value) => {
      if (value) {
        setLang(value);
      }
    });
    loadAIConfig().then((config) => {
      setAiConfig(config);
    });
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      Keyboard.dismiss();
      return undefined;
    }, []),
  );

  const renderReadonlyValue = (value, placeholder, opts = {}) => {
    const text = value && value.length > 0 ? value : placeholder;
    return (
      <Text
        style={[
          styles.readonlyText,
          !value && styles.readonlyPlaceholder,
          opts.isMultiline && styles.readonlyMultiline,
        ]}
        numberOfLines={opts.isMultiline ? 3 : 1}
      >
        {text}
      </Text>
    );
  };

  const changeLang = async (value) => {
    await setLanguage(value);
    setLang(value);
  };

  const handleSaveAI = async () => {
    setSaving(true);
    try {
      const next = await saveAIConfig(aiConfig);
      setAiConfig(next);
      setSaveStatus('saved');
      setIsEditingAI(false);
      Keyboard.dismiss();
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        setSaveStatus('idle');
      }, 1200);
    } catch (err) {
      Alert.alert(t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScrollBeginDrag={() => Keyboard.dismiss()}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.heading}>{t('settings.title')}</Text>
          <Card style={[styles.card, styles.cardFlat]}>
            <Text style={styles.label}>{t('settings.language')}</Text>
            <View style={styles.row}>
              <Pressable onPress={() => changeLang('zh')} style={lang === 'zh' ? styles.active : styles.inactive}>
                <Text style={styles.option}>中文</Text>
              </Pressable>
              <Pressable onPress={() => changeLang('en')} style={lang === 'en' ? styles.active : styles.inactive}>
                <Text style={styles.option}>English</Text>
              </Pressable>
            </View>
          </Card>
          <Card style={[styles.card, styles.cardFlat]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.label, styles.cardHeaderLabel]}>{t('settings.aiTitle')}</Text>
              {!isEditingAI ? (
                <Pressable style={styles.editButton} onPress={() => setIsEditingAI(true)}>
                  <Text style={styles.editButtonText}>{t('common.edit')}</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t('settings.aiModel')}</Text>
              {isEditingAI ? (
                <TextInput
                  value={aiConfig.model}
                  onChangeText={(value) => setAiConfig((prev) => ({ ...prev, model: value }))}
                  placeholder="gpt-4o"
                  style={styles.input}
                  autoCapitalize="none"
                />
              ) : (
                <View style={styles.readonlyField}>
                  {renderReadonlyValue(aiConfig.model, 'gpt-4o')}
                </View>
              )}
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t('settings.aiApiBase')}</Text>
              {isEditingAI ? (
                <TextInput
                  value={aiConfig.apiBase}
                  onChangeText={(value) => setAiConfig((prev) => ({ ...prev, apiBase: value }))}
                  placeholder="https://api.openai.com/v1"
                  style={styles.input}
                  autoCapitalize="none"
                />
              ) : (
                <View style={styles.readonlyField}>
                  {renderReadonlyValue(aiConfig.apiBase, 'https://api.openai.com/v1')}
                </View>
              )}
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t('settings.aiApiKey')}</Text>
              {isEditingAI ? (
                <TextInput
                  value={aiConfig.apiKey}
                  onChangeText={(value) => setAiConfig((prev) => ({ ...prev, apiKey: value }))}
                  placeholder="sk-..."
                  style={styles.input}
                  autoCapitalize="none"
                  secureTextEntry
                />
              ) : (
                <View style={styles.readonlyField}>
                  {renderReadonlyValue(aiConfig.apiKey ? '••••••••••' : '', 'sk-...')}
                </View>
              )}
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t('settings.aiPrompt')}</Text>
              {isEditingAI ? (
                <TextInput
                  value={aiConfig.prompt}
                  onChangeText={(value) => setAiConfig((prev) => ({ ...prev, prompt: value }))}
                  placeholder={t('settings.aiPromptPlaceholder')}
                  style={styles.textarea}
                  multiline
                  textAlignVertical="top"
                />
              ) : (
                <View style={[styles.readonlyField, styles.readonlyFieldMultiline]}>
                  {renderReadonlyValue(aiConfig.prompt, t('settings.aiPromptPlaceholder'), { isMultiline: true })}
                </View>
              )}
            </View>
            {isEditingAI ? (
              <Pressable style={styles.saveButton} onPress={handleSaveAI} disabled={saving}>
                <Text style={styles.saveText}>
                  {saving ? t('settings.saving') : saveStatus === 'saved' ? t('settings.saved') : t('common.save')}
                </Text>
              </Pressable>
            ) : null}
          </Card>
          <Card style={[styles.card, styles.cardFlat]}>
            <Text style={styles.label}>OpenContext</Text>
            <Text style={styles.about}>{t('settings.about')}</Text>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  heading: {
    ...typography.title,
    marginBottom: spacing.lg,
  },
  card: {
    marginBottom: spacing.md,
  },
  cardFlat: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  label: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  cardHeaderLabel: {
    marginBottom: 0,
  },
  editButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f4f1ed',
  },
  editButtonText: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 11,
    color: colors.mutedInk,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  field: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    ...typography.subtitle,
    color: colors.mutedInk,
    marginBottom: spacing.xs,
  },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.paper,
  },
  textarea: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 90,
    backgroundColor: colors.paper,
  },
  readonlyField: {
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: '#f4f1ed',
  },
  readonlyFieldMultiline: {
    minHeight: 90,
    justifyContent: 'flex-start',
  },
  readonlyText: {
    ...typography.body,
    color: colors.ink,
  },
  readonlyPlaceholder: {
    color: colors.mutedInk,
  },
  readonlyMultiline: {
    lineHeight: 20,
  },
  saveButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: '#fce8db',
  },
  saveText: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 12,
    color: colors.accent,
    fontWeight: '600',
  },
  option: {
    ...typography.body,
  },
  active: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  inactive: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  about: {
    ...typography.subtitle,
  },
});

module.exports = SettingsScreen;
