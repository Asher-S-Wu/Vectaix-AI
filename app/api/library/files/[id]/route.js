import { localizedRoute } from '@/lib/server/localizedRoute';
import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { updateFile, requireFile, fileMetadata, readText, deleteLibraryFile } from '@/lib/server/files/service';
function GETHandler(req, { params }) { return workbenchRoute(req, async userId => { const { id } = await params; return Response.json({ file: fileMetadata(await requireFile(userId, id)), ...(new URL(req.url).searchParams.has('text') ? { content: await readText(userId, id) } : {}) }); }); }
function PATCHHandler(req, { params }) { return workbenchRoute(req, async userId => Response.json({ file: await updateFile(userId, (await params).id, await readBody(req)) })); }
function DELETEHandler(req, { params }) { return workbenchRoute(req, async userId => { await deleteLibraryFile(userId, (await params).id); return Response.json({ ok: true }); }); }

export const GET = localizedRoute(GETHandler);
export const PATCH = localizedRoute(PATCHHandler);
export const DELETE = localizedRoute(DELETEHandler);
