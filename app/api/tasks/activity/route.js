import { localizedRoute } from '@/lib/server/localizedRoute';
import WorkbenchTask from '@/models/WorkbenchTask';
import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
function GETHandler(req) {
  return workbenchRoute(req, async userId => Response.json({tasks:await WorkbenchTask.find({userId}).sort({createdAt:-1}).limit(100).select('_id status conversationId').lean()}));
}

export const GET = localizedRoute(GETHandler);
