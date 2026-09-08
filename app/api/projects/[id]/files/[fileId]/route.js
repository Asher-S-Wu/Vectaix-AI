import { workbenchRoute } from "@/lib/server/workbench/apiHelpers";
import { deleteProjectDocument, readProjectDocument } from "@/lib/server/workbench/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  return workbenchRoute(request, async (userId) => {
    const { id, fileId } = await context.params;
    const query = new URL(request.url).searchParams;
    return Response.json(await readProjectDocument({ userId, projectId: id, fileId, offset: query.has("offset") ? Number(query.get("offset")) : 0, limit: query.has("limit") ? Number(query.get("limit")) : 12 }));
  });
}

export async function DELETE(request, context) {
  return workbenchRoute(request, async (userId) => {
    const { id, fileId } = await context.params;
    await deleteProjectDocument({ userId, projectId: id, fileId });
    return Response.json({ success: true });
  });
}
