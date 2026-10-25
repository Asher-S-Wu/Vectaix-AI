"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LOCALE_COOKIE, LOCALES, localeTag, translate } from '@/lib/shared/i18n.mjs';
import { localizeMessage as localizeSystemMessage } from '@/lib/shared/systemMessages.mjs';

const I18nContext = createContext(null);

export function I18nProvider({ initialLocale, children }) {
  const [locale, updateLocale] = useState(initialLocale);
  const router = useRouter();
  const setLocale = useCallback(nextLocale => {
    if (!LOCALES.includes(nextLocale)) throw new TypeError('Unsupported interface language.');
    document.cookie = `${LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    document.documentElement.lang = localeTag(nextLocale);
    updateLocale(nextLocale);
    localStorage.setItem(LOCALE_COOKIE, nextLocale);
    router.refresh();
  }, [router]);

  useEffect(() => {
    const sync = event => {
      if (event.key === LOCALE_COOKIE && LOCALES.includes(event.newValue)) {
        document.documentElement.lang = localeTag(event.newValue);
        updateLocale(event.newValue);
        router.refresh();
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [router]);

  const t = useCallback((zh, en, values) => translate(locale, zh, en, values), [locale]);
  const formatDate = useCallback((date, options) => new Intl.DateTimeFormat(localeTag(locale), options).format(new Date(date)), [locale]);
  const formatNumber = useCallback((number, options) => new Intl.NumberFormat(localeTag(locale), options).format(number), [locale]);
  const localizeMessage = useCallback(message => localizeSystemMessage(message, locale), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t, formatDate, formatNumber, localizeMessage }), [locale, setLocale, t, formatDate, formatNumber, localizeMessage]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within I18nProvider.');
  return context;
}
