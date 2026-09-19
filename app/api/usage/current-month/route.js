import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { currentMonthUsage } from '@/lib/server/usage/service';

export function GET(req) {
  return workbenchRoute(req, async userId => Response.json(await currentMonthUsage(userId), {
    headers: { 'Cache-Control': 'private, no-store' },
  }));
}
