import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { usageSummary } from '@/lib/server/usage/service';
export function GET(req) { return workbenchRoute(req, async userId => Response.json(await usageSummary(userId, new URL(req.url).searchParams))); }
