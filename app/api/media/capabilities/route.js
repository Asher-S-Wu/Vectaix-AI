import { localizedRoute } from '@/lib/server/localizedRoute';
import { requireUserRecord, unauthorizedResponse } from '@/lib/server/api/routeHelpers';
import { getMediaSettings } from '@/lib/server/media/settings';

export const dynamic = 'force-dynamic';

async function GETHandler(request) {
  const auth = await requireUserRecord({ request });
  if (!auth) return unauthorizedResponse('请先登录');
  const config = await getMediaSettings();
  const available = section => Boolean(section.enabled && section.hasApiKey);
  return Response.json({ image: available(config.image), elevenlabs: available(config.audio) }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = localizedRoute(GETHandler);
