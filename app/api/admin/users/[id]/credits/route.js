import mongoose from "mongoose";
import { requireAdmin } from "@/lib/admin";
import { forbiddenResponse } from "@/lib/server/api/routeHelpers";
import { creditErrorResponse, serializeCreditTransaction } from "@/lib/server/credits/api";
import { adjustBalance, getCreditSummary } from "@/lib/server/credits/service";

export const dynamic = "force-dynamic";

export async function PATCH(request, context) {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return Response.json({ error: "无效的用户 ID" }, { status: 400 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体格式错误" }, { status: 400 });
  }
  try {
    const transaction = await adjustBalance({
      operationId: body?.operationId,
      userId: id,
      targetBalance: body?.availablePoints,
      actorUserId: admin.userId,
      reason: body?.reason,
    });
    return Response.json({
      success: true,
      transaction: serializeCreditTransaction(transaction),
      targetCredit: await getCreditSummary(id),
    });
  } catch (error) {
    return creditErrorResponse(error, "设置用户积分失败");
  }
}
