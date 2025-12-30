const AsyncStorage = require('@react-native-async-storage/async-storage').default;

const CONFIG_KEY = '@opencontext/aiConfig';
const DEFAULT_PROMPT =
  'You are an AI within a journaling app. Your job is to help the user reflect on their thoughts in a thoughtful and kind manner. The user can never directly address you or directly respond to you. Try not to repeat what the user said, instead try to seed new ideas, encourage or debate. Keep your responses concise, but meaningful.';

const DEFAULT_CONFIG = {
  apiBase: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  apiKey: '',
  prompt: DEFAULT_PROMPT,
};

async function loadAIConfig() {
  const raw = await AsyncStorage.getItem(CONFIG_KEY);
  if (!raw) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function saveAIConfig(updates) {
  const current = await loadAIConfig();
  const next = { ...current, ...updates };
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  return next;
}

function isAIAvailable(config) {
  if (!config) return false;
  return Boolean(config.apiKey);
}

function resolveLanguageLabel(lang) {
  if (!lang) return 'English';
  if (lang.startsWith('zh')) return 'Chinese (简体中文)';
  if (lang.startsWith('en')) return 'English';
  return lang;
}

function buildMessages(entries, config, lang) {
  const language = resolveLanguageLabel(lang);
  const messages = [
    { role: 'system', content: config.prompt },
    { role: 'system', content: 'You can only respond in plaintext, do NOT use HTML or Markdown formatting.' },
    { role: 'system', content: `IMPORTANT: You MUST respond in ${language}. This is the user's preferred language.` },
  ];

  entries.forEach((entry) => {
    const text = entry?.content || entry?.text || '';
    messages.push({ role: 'user', content: text });
  });

  return messages;
}

async function generateReflection(entries, options = {}) {
  const config = options.config || await loadAIConfig();
  if (!isAIAvailable(config)) {
    throw new Error('AI not configured');
  }

  const messages = buildMessages(entries, config, options.language);
  const res = await fetch(`${config.apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: config.apiKey ? `Bearer ${config.apiKey}` : undefined,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `AI request failed (${res.status})`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';
  return content.trim();
}

module.exports = {
  loadAIConfig,
  saveAIConfig,
  isAIAvailable,
  generateReflection,
};
