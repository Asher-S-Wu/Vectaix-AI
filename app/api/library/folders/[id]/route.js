import { localizedRoute } from '@/lib/server/localizedRoute';
import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { updateFolder, deleteFolder } from '@/lib/server/files/service';
function PATCHHandler(req, { params }) { return workbenchRoute(req, async userId => Response.json({ folder: await updateFolder(userId, (await params).id, await readBody(req)) })); }
function DELETEHandler(req, { params }) { return workbenchRoute(req, async userId => { await deleteFolder(userId, (await params).id); return Response.json({ ok: true }); }); }

export const PATCH = localizedRoute(PATCHHandler);
export const DELETE = localizedRoute(DELETEHandler);
