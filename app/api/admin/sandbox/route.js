import { localizedRoute } from '@/lib/server/localizedRoute';
import { requireAdmin } from '@/lib/admin';
import { forbiddenResponse, parseJsonRequest } from '@/lib/server/api/routeHelpers';
import { getAdminSandboxSettings, getSandboxConnection, saveAdminSandboxSettings, sandboxError } from '@/lib/server/sandbox/settings';
import { testSandboxConnection } from '@/lib/server/sandbox/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };

function errorResponse(error) {
  return Response.json({ error: error.publicMessage ? error.message : '沙盒操作失败，请检查服务配置后重试' }, { status: error.status || 500, headers });
}

async function GETHandler(request) {
  try {
    if (!await requireAdmin(request)) return forbiddenResponse();
    return Response.json(await getAdminSandboxSettings(), { headers });
  } catch (error) { return errorResponse(error); }
}

async function PUTHandler(request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return forbiddenResponse();
    const parsed = await parseJsonRequest(request, '沙盒设置格式无效', 16384);
    if (!parsed.ok) return parsed.response;
    return Response.json(await saveAdminSandboxSettings(parsed.body, admin.userId), { headers });
  } catch (error) { return errorResponse(error); }
}

async function POSTHandler(request) {
  try {
    if (!await requireAdmin(request)) return forbiddenResponse();
    const connection = await getSandboxConnection();
    if (!connection) throw sandboxError('请先保存并启用云端沙盒');
    return Response.json(await testSandboxConnection(connection), { headers });
  } catch (error) { return errorResponse(error); }
}

export const GET = localizedRoute(GETHandler);
export const PUT = localizedRoute(PUTHandler);
export const POST = localizedRoute(POSTHandler);
