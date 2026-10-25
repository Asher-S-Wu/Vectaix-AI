import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, resolveLocale } from '@/lib/shared/i18n.mjs';

export async function getLocale() {
  const [jar, requestHeaders] = await Promise.all([cookies(), headers()]);
  return resolveLocale(jar.get(LOCALE_COOKIE)?.value, requestHeaders.get('accept-language') || '');
}

export function getRequestLocale(request) {
  const cookie = request.headers.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(`${LOCALE_COOKIE}=`));
  return resolveLocale(cookie?.slice(LOCALE_COOKIE.length + 1), request.headers.get('accept-language') || '');
}
