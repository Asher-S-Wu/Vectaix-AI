import YAML from 'yaml';
import { stopTasksForSettings } from '@/lib/server/settings/stopTasks';
import { workbenchRoute, readBody, booleanField } from '@/lib/server/workbench/apiHelpers';
import { requireSkill, skillAssets, deleteSkill, parseSkill } from '@/lib/server/skills/service';
export function GET(req, { params }) { return workbenchRoute(req, async userId => { const { id } = await params; return Response.json({ skill: await requireSkill(userId, id), assets: await skillAssets(userId, id) }); }); }
export function PATCH(req, { params }) { return workbenchRoute(req, async userId => { const { id } = await params, body = await readBody(req), skill = await requireSkill(userId, id); if (body.content !== undefined) { const content = /^---\r?\n/.test(body.content) ? body.content : `---\n${YAML.stringify({ name: skill.name, description: skill.description, ...skill.metadata })}---\n${body.content}`; skill.set(parseSkill(content)); } if (body.enabled !== undefined) skill.enabled = booleanField(body.enabled, '技能状态'); await skill.save(); if (body.enabled === false) await stopTasksForSettings(userId); return Response.json({ skill }); }); }
export function DELETE(req, { params }) { return workbenchRoute(req, async userId => { await deleteSkill(userId, (await params).id); await stopTasksForSettings(userId); return Response.json({ ok: true }); }); }
