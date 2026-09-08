import { withProjectLock } from "@/lib/server/workbench/projectLock";
import WorkspaceProject from "@/models/WorkspaceProject";
import WorkspaceDocument from "@/models/WorkspaceDocument";
import WorkbenchMemory from "@/models/WorkbenchMemory";
import WorkbenchTask from "@/models/WorkbenchTask";
import WorkbenchTaskEvent from "@/models/WorkbenchTaskEvent";
import Conversation from "@/models/Conversation";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";
import { requireProject } from "@/lib/server/workbench/catalog";
import { workbenchRoute, readBody, textField, booleanField, workbenchError } from "@/lib/server/workbench/apiHelpers";

export function GET(req, context) {
  return workbenchRoute(req, async (userId) => Response.json({ project: await requireProject(userId, (await context.params).id) }));
}

export function PUT(req, context) {
  return workbenchRoute(req, async (userId) => {
    const project = await requireProject(userId, (await context.params).id);
    const body = await readBody(req);
    for (const [key, label, max] of [["name", "项目名称", 100], ["description", "项目介绍", 2000], ["instructions", "项目指令", 20000]]) {
      if (Object.hasOwn(body, key)) project[key] = textField(body[key], label, max, key === "name");
    }
    if (Object.hasOwn(body, "memoryEnabled")) project.memoryEnabled = booleanField(body.memoryEnabled, "项目记忆");
    await project.save();
    return Response.json({ project });
  });
}

export function DELETE(req, context) {
  return workbenchRoute(req, async (userId) => {
    const id = (await context.params).id;
    return withProjectLock(userId, id, async () => {
    const project = await requireProject(userId, id);
    const projectId = project._id;
    if (await WorkbenchTask.exists({ userId, projectId, status: { $in: ["queued", "running", "waiting_media"] } })) {
      throw workbenchError("项目仍有进行中的任务，请先停止任务", 409);
    }
    const tasks = await WorkbenchTask.find({ userId, projectId }).select("_id").lean();
    await deleteStoredFilesByOwner({ userId, ownerType: "project", ownerId: String(projectId) });
    for (const task of tasks) await deleteStoredFilesByOwner({ userId, ownerType: "task", ownerId: String(task._id) });
    await WorkbenchTaskEvent.deleteMany({ userId, taskId: { $in: tasks.map((task) => task._id) } });
    await WorkbenchTask.deleteMany({ userId, projectId });
    await WorkspaceDocument.deleteMany({ userId, projectId });
    await WorkbenchMemory.deleteMany({ userId, projectId });
    await Conversation.updateMany({ userId, projectId }, { $set: { projectId: null } });
    await WorkspaceProject.deleteOne({ _id: projectId, userId });
    return Response.json({ success: true });
    });
  });
}
