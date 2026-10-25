import { localizedRoute } from '@/lib/server/localizedRoute';
import { readMultipart } from '@/lib/server/files/uploads';
import { getCurrentUserWithAccess } from '@/lib/admin';
import { editImage } from "@/lib/media/server/operations/imageEdit";
import { getAuthPayload } from "@/lib/auth";

import dbConnect from "@/lib/db";

async function POSTHandler(request) {
  try {
    const access = await getCurrentUserWithAccess(request);
    if (!access?.isAdmin) return Response.json({ error: '需要管理员权限' }, { status: access ? 403 : 401 });
    const user = await getAuthPayload(request);
    if (!user) return Response.json({ success: false, message: "未登录" }, { status: 401 });
    await dbConnect();
    const form = await readMultipart(request, 9 * 1024 * 1024);
    const body = { count: form.has("count") ? Number(form.get("count")) : 1, model: form.get("model"), prompt: form.get("prompt"), size: form.get("size"), ...(form.has("quality") ? { quality: form.get("quality") } : {}), images: form.getAll("images") };
    const result = await editImage({ userId: String(user.userId), body, clientOperationId: request.headers.get("x-credit-operation-id"), signal: request.signal });
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    if (error.status === 413) return Response.json({ success: false, message: error.message }, { status: 413 });
    return Response.json({ success: false, message: "图片编辑失败" }, { status: 500 });
  }
}

export const POST = localizedRoute(POSTHandler);
