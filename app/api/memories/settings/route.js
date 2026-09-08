import UserSettings from "@/models/UserSettings";
import { isPersonalMemoryEnabled } from "@/lib/server/workbench/catalog";
import { workbenchRoute, readBody, booleanField } from "@/lib/server/workbench/apiHelpers";

export function GET(req) {
  return workbenchRoute(req, async (userId) => Response.json({ enabled: await isPersonalMemoryEnabled(userId) }));
}
export function PUT(req) {
  return workbenchRoute(req, async (userId) => {
    const enabled = booleanField((await readBody(req)).enabled, "个人记忆");
    await UserSettings.updateOne({ userId }, { $set: { memoryEnabled: enabled, updatedAt: new Date() } }, { upsert: true });
    return Response.json({ enabled });
  });
}
