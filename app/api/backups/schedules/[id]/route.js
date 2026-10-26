import { localizedRoute } from '@/lib/server/localizedRoute';
import BackupSchedule from '@/models/BackupSchedule';
import { workbenchRoute, readBody, requireObjectId } from '@/lib/server/workbench/apiHelpers';
import { saveSchedule, setScheduleEnabled } from '@/lib/server/backups/service';
function PUTHandler(req, { params }) { return workbenchRoute(req, async userId => Response.json({ schedule: await saveSchedule(userId, await readBody(req), (await params).id) })); }
function PATCHHandler(req, { params }) { return workbenchRoute(req, async userId => Response.json({ schedule: await setScheduleEnabled(userId, (await params).id, (await readBody(req)).enabled) })); }
function DELETEHandler(req, { params }) { return workbenchRoute(req, async userId => { const { id } = await params; requireObjectId(id); await BackupSchedule.deleteOne({ _id: id, userId }); return Response.json({ ok: true }); }); }

export const PUT = localizedRoute(PUTHandler);
export const PATCH = localizedRoute(PATCHHandler);
export const DELETE = localizedRoute(DELETEHandler);
