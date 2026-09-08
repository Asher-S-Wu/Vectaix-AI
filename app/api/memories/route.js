import WorkbenchMemory from "@/models/WorkbenchMemory";
import { requireProject, saveMemory } from "@/lib/server/workbench/catalog";
import { workbenchRoute, readBody } from "@/lib/server/workbench/apiHelpers";

export function GET(req) {
  return workbenchRoute(req, async (userId) => {
    const projectId = new URL(req.url).searchParams.get("projectId");
    if (projectId) await requireProject(userId, projectId);
    const query = projectId ? { userId, projectId: { $in: [null, projectId] } } : { userId, projectId: null };
    return Response.json({ memories: await WorkbenchMemory.find(query).sort({ updatedAt: -1 }).lean() });
  });
}
export function POST(req) {
  return workbenchRoute(req, async (userId) => {
    const body = await readBody(req);
    const memory = await saveMemory({ userId, projectId: body.projectId === undefined ? null : body.projectId, content: body.content });
    return Response.json({ memory }, { status: 201 });
  });
}
