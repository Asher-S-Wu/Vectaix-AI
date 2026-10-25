import { localizedRoute } from '@/lib/server/localizedRoute';
import { readMultipart } from '@/lib/server/files/uploads';
import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { uploadLibrary } from '@/lib/server/files/service';
function POSTHandler(req) { return workbenchRoute(req, async userId => { const data = await readMultipart(req, 100*1024*1024+262144); return Response.json({ files: await uploadLibrary(userId, data.getAll('files'), data.get('folderId')) }); }); }

export const POST = localizedRoute(POSTHandler);
