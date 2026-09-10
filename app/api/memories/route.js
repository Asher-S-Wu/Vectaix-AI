import WorkbenchMemory from "@/models/WorkbenchMemory";
import { requireProject, saveMemory } from "@/lib/server/workbench/catalog";
import { workbenchRoute, readBody, requireObjectId, workbenchError } from "@/lib/server/workbench/apiHelpers";

export function GET(req) {
  return workbenchRoute(req, async (userId) => {
    const params = new URL(req.url).searchParams;
    const projectId = params.get("projectId");
    if (projectId) await requireProject(userId, projectId);
    const query = projectId ? { userId, projectId: { $in: [null, projectId] } } : { userId, projectId: null };
    const search = params.get('q')?.trim();
    if (search?.length > 200) throw workbenchError('搜索内容过长');
    if (search) query.content = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (params.get('cursor')) query._id = { $lt: requireObjectId(params.get('cursor')) };
    const memories = await WorkbenchMemory.find(query).sort({ _id: -1 }).limit(26).lean();
    const more = memories.length > 25;
    if (more) memories.pop();
    return Response.json({ memories, nextCursor: more ? String(memories.at(-1)._id) : null });
  });
}
export function POST(req) {
  return workbenchRoute(req, async (userId) => {
    const body = await readBody(req);
    const memory = await saveMemory({ userId, projectId: body.projectId === undefined ? null : body.projectId, content: body.content });
    return Response.json({ memory }, { status: 201 });
  });
}
