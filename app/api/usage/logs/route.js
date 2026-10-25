import { localizedRoute } from '@/lib/server/localizedRoute';
import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { toolLogs } from '@/lib/server/usage/service';

function GETHandler(req) {
  return workbenchRoute(req, async userId => {
    const events = await toolLogs(userId, new URL(req.url).searchParams);
    return Response.json({ events });
  });
}

export const GET = localizedRoute(GETHandler);
