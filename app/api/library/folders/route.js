import FileFolder from '@/models/FileFolder';
import { workbenchRoute, readBody, textField } from '@/lib/server/workbench/apiHelpers';
import { requireFolder } from '@/lib/server/files/service';
export function POST(req) { return workbenchRoute(req, async userId => { const body = await readBody(req); await requireFolder(userId, body.parentId); return Response.json({ folder: await FileFolder.create({ userId, parentId: body.parentId || null, name: textField(body.name, '文件夹名称', 200, true) }) }); }); }
