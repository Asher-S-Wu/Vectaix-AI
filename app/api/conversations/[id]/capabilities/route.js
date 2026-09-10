import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { getConversationCapabilities, updateConversationCapabilities } from '@/lib/server/settings/capabilities';

export function GET(req, context) {
  return workbenchRoute(req, async userId => Response.json(await getConversationCapabilities(userId, (await context.params).id)));
}
export function PUT(req, context) {
  return workbenchRoute(req, async userId => Response.json(await updateConversationCapabilities(userId, (await context.params).id, await readBody(req))));
}
