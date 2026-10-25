import { localizedRoute } from '@/lib/server/localizedRoute';
import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { usageSummary } from '@/lib/server/usage/service';
function GETHandler(req) { return workbenchRoute(req, async userId => Response.json(await usageSummary(userId, new URL(req.url).searchParams))); }

export const GET = localizedRoute(GETHandler);
