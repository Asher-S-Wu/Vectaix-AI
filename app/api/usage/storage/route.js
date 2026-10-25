import { localizedRoute } from '@/lib/server/localizedRoute';
import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { storageSummary, cleanupStorage } from '@/lib/server/usage/service';
function GETHandler(req) { return workbenchRoute(req, async userId => Response.json(await storageSummary(userId))); }
function DELETEHandler(req) { return workbenchRoute(req, async userId => Response.json(await cleanupStorage(userId, (await readBody(req)).fileIds))); }

export const GET = localizedRoute(GETHandler);
export const DELETE = localizedRoute(DELETEHandler);
