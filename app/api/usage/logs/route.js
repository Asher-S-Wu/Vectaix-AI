import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { toolLogs } from '@/lib/server/usage/service';

export function GET(req) {
  return workbenchRoute(req, async userId => {
    const events = await toolLogs(userId, new URL(req.url).searchParams);
    return Response.json({ events });
  });
}
