import WorkbenchSkill from '@/models/WorkbenchSkill';
import { ensureBuiltinSkills } from '@/lib/server/workbench/catalog';
import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { parseSkill } from '@/lib/server/skills/service';
export function GET(req) { return workbenchRoute(req, async userId => { await ensureBuiltinSkills(userId); return Response.json({ skills: await WorkbenchSkill.find({ userId }).sort({ createdAt: 1 }).lean() }); }); }
export function POST(req) { return workbenchRoute(req, async userId => { const body = await readBody(req); const parsed = parseSkill(body.content); return Response.json({ skill: await WorkbenchSkill.create({ userId, ...parsed, enabled: true }) }, { status: 201 }); }); }
