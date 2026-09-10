import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { copyToProject, fileMetadata } from '@/lib/server/files/service';
export function POST(req, { params }) { return workbenchRoute(req, async userId => Response.json({ file: fileMetadata(await copyToProject(userId, (await params).id, (await readBody(req)).projectId)) })); }
