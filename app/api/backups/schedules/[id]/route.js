import { localizedRoute } from '@/lib/server/localizedRoute';
import BackupSchedule from '@/models/BackupSchedule';
import { workbenchRoute, readBody, requireObjectId, booleanField, workbenchError } from '@/lib/server/workbench/apiHelpers';
import { saveSchedule } from '@/lib/server/backups/service';
function PUTHandler(req, { params }) { return workbenchRoute(req, async userId => Response.json({ schedule: await saveSchedule(userId, await readBody(req), (await params).id) })); }
function PATCHHandler(req, { params }) { return workbenchRoute(req, async userId => { const { id } = await params, body = await readBody(req); requireObjectId(id); const schedule = await BackupSchedule.findOneAndUpdate({ _id: id, userId }, { $set: { enabled: booleanField(body.enabled, '定时备份状态') } }, { new: true }); if (!schedule) throw workbenchError('定时备份不存在', 404); return Response.json({ schedule }); }); }
function DELETEHandler(req, { params }) { return workbenchRoute(req, async userId => { const { id } = await params; requireObjectId(id); await BackupSchedule.deleteOne({ _id: id, userId }); return Response.json({ ok: true }); }); }

export const PUT = localizedRoute(PUTHandler);
export const PATCH = localizedRoute(PATCHHandler);
export const DELETE = localizedRoute(DELETEHandler);
