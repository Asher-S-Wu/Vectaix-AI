import { localizedRoute } from '@/lib/server/localizedRoute';
import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { deleteBackup } from '@/lib/server/backups/service';
function DELETEHandler(req, { params }) { return workbenchRoute(req, async userId => { await deleteBackup(userId, (await params).id); return Response.json({ ok: true }); }); }

export const DELETE = localizedRoute(DELETEHandler);
