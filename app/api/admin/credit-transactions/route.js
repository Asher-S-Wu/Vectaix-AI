import CreditTransaction from "@/models/CreditTransaction";
import { requireAdmin } from "@/lib/admin";
import { forbiddenResponse } from "@/lib/server/api/routeHelpers";
import { creditErrorResponse, serializeCreditTransaction } from "@/lib/server/credits/api";
import { settleCredits } from "@/lib/server/credits/service";
import { resolveMinimaxUnlockClaimByOperation } from "@/lib/media/server/minimaxUnlockClaims";
import { syncMediaTaskBillingByOperation } from "@/lib/media/server/billing";

export const dynamic = "force-dynamic";

function safeLimit(value) {
  const parsed = Number(value || 20);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20;
}

export async function GET(request) {
  if (!await requireAdmin(request)) return forbiddenResponse();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "review_required";
  const allowedStatuses = new Set(["pending", "reserved", "settling", "review_required"]);
  if (!allowedStatuses.has(status)) {
    return Response.json({ error: "不支持的流水状态" }, { status: 400 });
  }
  try {
    const documents = await CreditTransaction.find({ status })
      .sort({ createdAt: 1, _id: 1 })
      .limit(safeLimit(searchParams.get("limit")))
      .populate("userId", "email")
      .lean();
    return Response.json({
      transactions: documents.map((document) => ({
        ...serializeCreditTransaction(document),
        userEmail: document.userId?.email || "已删除用户",
        actualCostCny: Number.isFinite(document.actualCostCny) ? document.actualCostCny : null,
        actualCostUsd: Number.isFinite(document.actualCostUsd) ? document.actualCostUsd : null,
        pricingVersion: Number.isSafeInteger(document.pricingSnapshot?.version)
          ? document.pricingSnapshot.version
          : null,
        walletExempt: document.walletExempt === true,
        upstreamRequestIds: Array.isArray(document.upstreamRequestIds)
          ? document.upstreamRequestIds
          : [],
      })),
    });
  } catch (error) {
    return creditErrorResponse(error, "读取待核对流水失败");
  }
}

export async function PATCH(request) {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体格式错误" }, { status: 400 });
  }
  const action = body?.action;
  if (typeof body?.operationId !== "string" || !body.operationId.trim() || body.operationId.length > 200) {
    return Response.json({ error: "积分流水操作号无效" }, { status: 400 });
  }
  const operationId = body.operationId.trim();
  if (!["settle", "release"].includes(action)) {
    return Response.json({ error: "不支持的核对操作" }, { status: 400 });
  }
  if (typeof body?.reason !== "string" || !body.reason.trim()) {
    return Response.json({ error: "请填写核对原因" }, { status: 400 });
  }
  try {
    const existing = await CreditTransaction.findOne({
      operationId,
      status: "review_required",
    }).lean();
    if (!existing) return Response.json({ error: "待核对流水不存在" }, { status: 404 });
    if (existing.type !== "model_usage") {
      return Response.json(
        { error: "这不是模型消费流水，不能按冻结积分结算；请重新执行对应的管理操作" },
        { status: 409 },
      );
    }
    const chargedPoints = action === "settle" ? body?.chargedPoints : 0;
    if (
      action === "settle"
      && (!Number.isSafeInteger(chargedPoints) || chargedPoints < 1)
    ) {
      return Response.json(
        { error: "实扣积分必须是大于 0 的整数" },
        { status: 400 },
      );
    }
    const transaction = await settleCredits({
      operationId: existing.operationId,
      chargedPoints,
      usage: existing.usage,
      pricingSnapshot: existing.pricingSnapshot,
      upstreamRequestIds: existing.upstreamRequestIds,
      actualCostCny: existing.actualCostCny,
      actualCostUsd: existing.actualCostUsd,
      actorUserId: admin.userId,
      reason: body.reason.trim(),
      allowAdditionalDebit: action === "settle",
    });
    await resolveMinimaxUnlockClaimByOperation({
      operationId: existing.operationId,
      action,
    });
    await syncMediaTaskBillingByOperation(existing.operationId, transaction);
    return Response.json({
      success: true,
      transaction: serializeCreditTransaction(transaction),
    });
  } catch (error) {
    return creditErrorResponse(error, "核对积分流水失败");
  }
}
