import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { listLibrary } from '@/lib/server/files/service';
export function GET(req) { return workbenchRoute(req, async userId => Response.json(await listLibrary(userId, new URL(req.url).searchParams.get('folderId')))); }
