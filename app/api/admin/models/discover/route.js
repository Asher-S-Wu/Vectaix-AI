import { localizedRoute } from '@/lib/server/localizedRoute';
import { requireAdmin } from '@/lib/admin';
import { forbiddenResponse, parseJsonRequest } from '@/lib/server/api/routeHelpers';
import { discoverModels } from '@/lib/server/models/service';
import { modelApiError } from '@/lib/server/models/api';

export const dynamic = 'force-dynamic';
async function POSTHandler(request) {
  try {
    if (!await requireAdmin(request)) return forbiddenResponse();
    const parsed = await parseJsonRequest(request, '模型连接设置格式无效', 16384);
    if (!parsed.ok) return parsed.response;
    return Response.json(await discoverModels(parsed.body), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return modelApiError(error); }
}

export const POST = localizedRoute(POSTHandler);
