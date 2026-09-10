import WorkbenchTask from '@/models/WorkbenchTask';
import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
export function GET(req) {
  return workbenchRoute(req, async userId => Response.json({tasks:await WorkbenchTask.find({userId}).sort({createdAt:-1}).limit(100).select('_id status conversationId').lean()}));
}
