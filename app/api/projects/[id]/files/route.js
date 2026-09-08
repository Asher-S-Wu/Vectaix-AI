import { workbenchRoute, workbenchError } from "@/lib/server/workbench/apiHelpers";
import { listProjectFiles, uploadProjectDocument, MAX_DOCUMENT_BYTES } from "@/lib/server/workbench/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  return workbenchRoute(request, async (userId) => {
    const { id } = await context.params;
    return Response.json({ files: await listProjectFiles({ userId, projectId: id }) });
  });
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
    const { id } = await context.params;
    const form = await boundedFormData(request);
    if (form.getAll("file").length !== 1 || [...form.keys()].some((key) => key !== "file")) throw workbenchError("每次只能上传一个文件");
    const file = await uploadProjectDocument({ userId, projectId: id, file: form.get("file") });
    return Response.json({ file }, { status: 201 });
  });
}
