import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { deleteBackup } from '@/lib/server/backups/service';
export function DELETE(req, { params }) { return workbenchRoute(req, async userId => { await deleteBackup(userId, (await params).id); return Response.json({ ok: true }); }); }
