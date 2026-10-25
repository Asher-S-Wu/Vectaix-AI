import { localizedRoute } from '@/lib/server/localizedRoute';
import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { listLibrary, deleteLibraryFiles } from '@/lib/server/files/service';
function GETHandler(req) { return workbenchRoute(req, async userId => Response.json(await listLibrary(userId, new URL(req.url).searchParams.get('folderId')))); }

function DELETEHandler(req) { return workbenchRoute(req, async userId => { await deleteLibraryFiles(userId, (await readBody(req)).fileIds); return Response.json({ ok: true }); }); }

export const GET = localizedRoute(GETHandler);
export const DELETE = localizedRoute(DELETEHandler);
