import { editImage } from "@/lib/media/server/operations/imageEdit";
import { getAuthPayload } from "@/lib/auth";

import dbConnect from "@/lib/db";

export async function POST(request) {
  try {
    const user = await getAuthPayload(request);
    if (!user) return Response.json({ success: false, message: "未登录" }, { status: 401 });
    await dbConnect();
    const form = await request.formData();
    const body = { prompt: form.get("prompt"), size: form.get("size"), images: form.getAll("images") };
    const result = await editImage({ userId: String(user.userId), body, clientOperationId: request.headers.get("x-credit-operation-id"), signal: request.signal });
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json({ success: false, message: error.message }, { status: error.status || error.statusCode || 500 });
  }
}
