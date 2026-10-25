import { localizedRoute } from '@/lib/server/localizedRoute';
import { getCurrentUserWithAccess } from '@/lib/admin';
import { getMediaSettings, saveMediaSettings } from '@/lib/server/media/settings';
import { readBody } from '@/lib/server/workbench/apiHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request, write) {
  try {
    const user = await getCurrentUserWithAccess(request);
    if (!user) return Response.json({ error: '请先登录' }, { status: 401 });
    if (!user.isAdmin) return Response.json({ error: '需要管理员权限' }, { status: 403 });
    const config = write ? await saveMediaSettings(await readBody(request)) : await getMediaSettings();
    return Response.json({ config }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error.status ? error.message : '媒体配置保存失败，请检查服务设置' }, { status: error.status || 500 });
  }
}
const GETHandler = request => handle(request, false);
const PUTHandler = request => handle(request, true);

export const GET = localizedRoute(GETHandler);
export const PUT = localizedRoute(PUTHandler);
