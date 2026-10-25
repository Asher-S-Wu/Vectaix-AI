import { localizedRoute } from '@/lib/server/localizedRoute';
import { requireAdmin } from '@/lib/admin';
import { forbiddenResponse, parseJsonRequest } from '@/lib/server/api/routeHelpers';
import { getAdminModelSettings, saveAdminModelSettings } from '@/lib/server/models/service';
import { modelApiError } from '@/lib/server/models/api';

export const dynamic = 'force-dynamic';
async function GETHandler(request) {
  try {
    if (!await requireAdmin(request)) return forbiddenResponse();
    return Response.json(await getAdminModelSettings(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return modelApiError(error); }
}
async function PUTHandler(request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return forbiddenResponse();
    const parsed = await parseJsonRequest(request, '模型设置格式无效', 32768);
    if (!parsed.ok) return parsed.response;
    return Response.json(await saveAdminModelSettings(parsed.body, admin.userId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return modelApiError(error); }
}

export const GET = localizedRoute(GETHandler);
export const PUT = localizedRoute(PUTHandler);
