import { generateImage } from "@/lib/media/server/operations/image";
import { parseJsonRequest } from "@/lib/server/api/routeHelpers";
import { getAuthPayload } from "@/lib/auth";

import dbConnect from "@/lib/db";

export async function POST(request) {
  try {
    const user = await getAuthPayload(request);
    if (!user) return Response.json({ success: false, message: "未登录" }, { status: 401 });
    await dbConnect();
    const parsed = await parseJsonRequest(request, "请求内容格式错误", 262144);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const result = await generateImage({ userId: String(user.userId), body, clientOperationId: request.headers.get("x-credit-operation-id"), signal: request.signal });
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json({ success: false, message: error.message }, { status: error.status || error.statusCode || 500 });
  }
}
