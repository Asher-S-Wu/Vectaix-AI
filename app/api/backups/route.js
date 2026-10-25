import { localizedRoute } from '@/lib/server/localizedRoute';
import BackupJob from '@/models/BackupJob';
import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { createBackup } from '@/lib/server/backups/service';
function GETHandler(req) { return workbenchRoute(req, async userId => Response.json({ jobs: await BackupJob.find({ userId }).sort({ createdAt: -1 }).limit(100).lean() })); }
function POSTHandler(req) { return workbenchRoute(req, async userId => Response.json({ job: await createBackup(userId, await readBody(req)) }, { status: 201 })); }

export const GET = localizedRoute(GETHandler);
export const POST = localizedRoute(POSTHandler);
