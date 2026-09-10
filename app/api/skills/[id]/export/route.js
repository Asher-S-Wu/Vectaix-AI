import { Readable } from 'node:stream';
import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { exportSkill } from '@/lib/server/skills/service';
export function GET(req, { params }) { return workbenchRoute(req, async userId => new Response(Readable.toWeb(await exportSkill(userId, (await params).id)), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="skill.skill"' } })); }
