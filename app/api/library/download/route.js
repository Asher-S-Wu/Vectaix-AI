import { localizedRoute } from '@/lib/server/localizedRoute';
import { Readable } from 'node:stream';
import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { downloadFiles } from '@/lib/server/files/service';
function POSTHandler(req) { return workbenchRoute(req, async userId => new Response(Readable.toWeb(await downloadFiles(userId, (await readBody(req)).fileIds)), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="files.zip"' } })); }

export const POST = localizedRoute(POSTHandler);
