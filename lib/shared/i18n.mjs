export const LOCALE_COOKIE = 'huajuan_locale';
export const LOCALES = Object.freeze(['zh', 'en']);
export const localeTag = locale => locale === 'en' ? 'en-US' : 'zh-CN';

export function resolveLocale(cookieValue, acceptLanguage = '') {
  if (LOCALES.includes(cookieValue)) return cookieValue;
  const languages = acceptLanguage.split(',').map(value => {
    const [tag, quality] = value.trim().split(';');
    return { language: tag.toLowerCase().split('-')[0], quality: quality ? Number(quality.trim().replace(/^q=/, '')) : 1 };
  }).filter(value => LOCALES.includes(value.language) && value.quality > 0)
    .sort((a, b) => b.quality - a.quality);
  return languages[0]?.language || 'zh';
}

export function translate(locale, zh, en, values = {}) {
  if (!LOCALES.includes(locale) || typeof zh !== 'string' || typeof en !== 'string') {
    throw new TypeError('Translations require a supported locale and both language strings.');
  }
  return (locale === 'en' ? en : zh).replace(/\{(\w+)\}/g, (placeholder, key) => {
    if (!Object.hasOwn(values, key)) throw new TypeError(`Missing translation value: ${key}`);
    return String(values[key]);
  });
}

export function getClientLocale() {
  return typeof document !== 'undefined' && document.documentElement.lang.startsWith('en') ? 'en' : 'zh';
}

export function clientText(zh, en, values) {
  return translate(getClientLocale(), zh, en, values);
}
