import { localizedRoute } from '@/lib/server/localizedRoute';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { backupDownload } from '@/lib/server/backups/service';
function GETHandler(req, { params }) { return workbenchRoute(req, async userId => { const file = await backupDownload(userId, (await params).id); return new Response(Readable.toWeb(createReadStream(file.path)), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'no-store' } }); }); }

export const GET = localizedRoute(GETHandler);
