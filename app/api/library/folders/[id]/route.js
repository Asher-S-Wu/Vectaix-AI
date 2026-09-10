import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { updateFolder, deleteFolder } from '@/lib/server/files/service';
export function PATCH(req, { params }) { return workbenchRoute(req, async userId => Response.json({ folder: await updateFolder(userId, (await params).id, await readBody(req)) })); }
export function DELETE(req, { params }) { return workbenchRoute(req, async userId => { await deleteFolder(userId, (await params).id); return Response.json({ ok: true }); }); }
