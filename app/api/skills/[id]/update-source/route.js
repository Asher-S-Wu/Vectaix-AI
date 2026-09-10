import { workbenchRoute, workbenchError } from '@/lib/server/workbench/apiHelpers';
import { requireSkill, importSkill } from '@/lib/server/skills/service';
export function POST(req, { params }) { return workbenchRoute(req, async userId => { const skill = await requireSkill(userId, (await params).id); if (skill.source?.type !== 'github') throw workbenchError('只有 GitHub 导入的技能可以检查源更新'); return Response.json({ skill: await importSkill(userId, { githubUrl: skill.source.url, replaceId: String(skill._id) }) }); }); }
