import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { listLibrary, deleteLibraryFiles } from '@/lib/server/files/service';
export function GET(req) { return workbenchRoute(req, async userId => Response.json(await listLibrary(userId, new URL(req.url).searchParams.get('folderId')))); }

export function DELETE(req) { return workbenchRoute(req, async userId => { await deleteLibraryFiles(userId, (await readBody(req)).fileIds); return Response.json({ ok: true }); }); }
