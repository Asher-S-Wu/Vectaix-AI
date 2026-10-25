import { getRequestLocale } from '@/lib/server/i18n';
import { localizeMessage } from '@/lib/shared/systemMessages.mjs';
import { localeTag } from '@/lib/shared/i18n.mjs';

export function localizedRoute(handler) {
  return async function route(request, context) {
    const response = await handler(request, context);
    if (response.ok || !response.headers.get('content-type')?.includes('application/json')) return response;
    const payload = await response.json();
    const locale = getRequestLocale(request);
    if (typeof payload?.error === 'string') payload.error = localizeMessage(payload.error, locale);
    if (typeof payload?.message === 'string') payload.message = localizeMessage(payload.message, locale);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('content-language', localeTag(locale));
    headers.set('cache-control', 'no-store');
    return new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers });
  };
}
