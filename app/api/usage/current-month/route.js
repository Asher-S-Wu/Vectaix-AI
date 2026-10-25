import { localizedRoute } from '@/lib/server/localizedRoute';
import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { currentMonthUsage } from '@/lib/server/usage/service';

function GETHandler(req) {
  return workbenchRoute(req, async userId => Response.json(await currentMonthUsage(userId), {
    headers: { 'Cache-Control': 'private, no-store' },
  }));
}

export const GET = localizedRoute(GETHandler);
