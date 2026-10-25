import { localizedRoute } from '@/lib/server/localizedRoute';
import { readMultipart } from '@/lib/server/files/uploads';
import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { inspectBackup } from '@/lib/server/backups/service';
function POSTHandler(req) { return workbenchRoute(req, async userId => { const body = await readMultipart(req, 520*1024*1024); return Response.json(await inspectBackup(userId, body.get('file'), body.get('password'))); }); }

export const POST = localizedRoute(POSTHandler);
