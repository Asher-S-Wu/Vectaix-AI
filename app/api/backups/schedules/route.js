import { localizedRoute } from '@/lib/server/localizedRoute';
import BackupSchedule from '@/models/BackupSchedule';
import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { saveSchedule } from '@/lib/server/backups/service';
function GETHandler(req) { return workbenchRoute(req, async userId => Response.json({ schedules: await BackupSchedule.find({ userId }).sort({ createdAt: 1 }).lean() })); }
function POSTHandler(req) { return workbenchRoute(req, async userId => Response.json({ schedule: await saveSchedule(userId, await readBody(req)) })); }

export const GET = localizedRoute(GETHandler);
export const POST = localizedRoute(POSTHandler);
