import WorkbenchMemory from "@/models/WorkbenchMemory";
import { requireProject } from "@/lib/server/workbench/catalog";
import { workbenchRoute, readBody, textField, requireObjectId, workbenchError } from "@/lib/server/workbench/apiHelpers";

async function findMemory(userId, context) {
  const id = requireObjectId((await context.params).id);
  const memory = await WorkbenchMemory.findOne({ userId, _id: id });
  if (!memory) throw workbenchError("记忆不存在", 404);
  return memory;
}
export function PUT(req, context) {
  return workbenchRoute(req, async (userId) => {
    const memory = await findMemory(userId, context);
    const body = await readBody(req);
    if (Object.hasOwn(body, "content")) memory.content = textField(body.content, "记忆内容", 4000, true);
    if (Object.hasOwn(body, "projectId")) {
      if (body.projectId !== null) await requireProject(userId, body.projectId);
      memory.projectId = body.projectId;
      memory.scope = body.projectId ? "project" : "personal";
    }
    await memory.save();
    return Response.json({ memory });
  });
}
export function DELETE(req, context) {
  return workbenchRoute(req, async (userId) => {
    await (await findMemory(userId, context)).deleteOne();
    return Response.json({ success: true });
  });
}
