const i18n = require('i18next');
const { initReactI18next } = require('react-i18next');
const AsyncStorage = require('@react-native-async-storage/async-storage').default;
const en = require('./locales/en.json');
const zh = require('./locales/zh.json');

const LANGUAGE_KEY = '@opencontext/lang';

async function initI18n() {
  const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
  const initialLanguage = stored || 'zh';

  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    lng: initialLanguage,
    fallbackLng: 'en',
    compatibilityJSON: 'v3',
    interpolation: { escapeValue: false },
  });
}

async function setLanguage(lang) {
  await i18n.changeLanguage(lang);
  await AsyncStorage.setItem(LANGUAGE_KEY, lang);
}

async function getLanguage() {
  return AsyncStorage.getItem(LANGUAGE_KEY);
}

module.exports = {
  initI18n,
  setLanguage,
  getLanguage,
};
