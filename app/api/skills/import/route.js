import { readMultipart } from '@/lib/server/files/uploads';
import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { importSkill } from '@/lib/server/skills/service';
export function POST(req) { return workbenchRoute(req, async userId => { let input; if (req.headers.get('content-type')?.includes('application/json')) input = await readBody(req); else { const data = await readMultipart(req, 50*1024*1024+65536), file = data.get('file'); if (!file || file.size > 50*1024*1024) return Response.json({ error: '请选择 50 MB 以内的技能文件' }, { status: 400 }); input = { name: file.name, buffer: Buffer.from(await file.arrayBuffer()) }; } return Response.json({ skill: await importSkill(userId, input) }, { status: 201 }); }); }
