import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { storageSummary, cleanupStorage } from '@/lib/server/usage/service';
export function GET(req) { return workbenchRoute(req, async userId => Response.json(await storageSummary(userId))); }
export function DELETE(req) { return workbenchRoute(req, async userId => Response.json(await cleanupStorage(userId, (await readBody(req)).fileIds))); }
