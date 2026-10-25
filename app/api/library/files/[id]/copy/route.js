import { localizedRoute } from '@/lib/server/localizedRoute';
import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { copyToProject, fileMetadata } from '@/lib/server/files/service';
function POSTHandler(req, { params }) { return workbenchRoute(req, async userId => Response.json({ file: fileMetadata(await copyToProject(userId, (await params).id, (await readBody(req)).projectId)) })); }

export const POST = localizedRoute(POSTHandler);
