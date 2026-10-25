import dbConnect from '@/lib/db';
import { requireAdmin } from '@/lib/admin';

export async function adminSkillsRoute(request, action) {
  if (!await requireAdmin(request)) return Response.json({ error: '请使用管理员账号管理技能' }, { status: 403 });
  try {
    await dbConnect();
    return Response.json(await action());
  } catch (error) {
    if (!error.status) console.error('[Skills] Admin operation failed', error);
    return Response.json({ error: error.status ? error.message : '技能操作失败，请检查服务器配置' }, { status: error.status || 500 });
  }
}
