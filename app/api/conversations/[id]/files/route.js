import Conversation from "@/models/Conversation";
import { workbenchRoute, workbenchError, readBody, requireObjectId } from "@/lib/server/workbench/apiHelpers";
import { listProjectFiles, uploadConversationDocument, deleteConversationDocument, MAX_DOCUMENT_BYTES } from "@/lib/server/workbench/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function scope(userId, context) {
  const { id } = await context.params;
  requireObjectId(id);
  const conversation = await Conversation.findOne({ _id: id, userId }).select('projectId').lean();
  if (!conversation) throw workbenchError("对话不存在", 404);
  return { userId, conversationId: id, projectId: conversation.projectId ? String(conversation.projectId) : null };
}

export async function GET(request, context) {
  return workbenchRoute(request, async (userId) => Response.json({ files: await listProjectFiles(await scope(userId, context)) }));
}

async function boundedFormData(request) {
  const maxBody = MAX_DOCUMENT_BYTES + 64 * 1024;
  const contentType = request.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data;") || !request.body) throw workbenchError("请使用文件上传表单");
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBody) throw workbenchError("文件大小不能超过 20MB", 413);
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBody) {
        await reader.cancel();
        throw workbenchError("文件大小不能超过 20MB", 413);
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    return await new Response(Buffer.concat(parts), { headers: { "Content-Type": contentType } }).formData();
  } catch { throw workbenchError("文件上传表单格式不正确"); }
}

export async function POST(request, context) {
  return workbenchRoute(request, async (userId) => {
    const current = await scope(userId, context);
    const form = await boundedFormData(request);
    if (form.getAll("file").length !== 1 || [...form.keys()].some(key => key !== "file")) throw workbenchError("每次只能上传一个文件");
    const file = await uploadConversationDocument({ ...current, file: form.get("file") });
    return Response.json({ file }, { status: 201 });
  });
}

export async function DELETE(request, context) {
  return workbenchRoute(request, async (userId) => {
    const current = await scope(userId, context);
    const { fileId } = await readBody(request);
    if (typeof fileId !== "string") throw workbenchError("文件编号无效");
    await deleteConversationDocument({ ...current, fileId });
    return Response.json({ success: true });
  });
}
