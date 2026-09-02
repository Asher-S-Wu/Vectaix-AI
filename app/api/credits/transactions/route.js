import { getAuthPayload } from "@/lib/auth";
import { creditErrorResponse, serializeCreditTransaction } from "@/lib/server/credits/api";
import { listTransactions } from "@/lib/server/credits/service";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await getAuthPayload(request);
  if (!auth) return Response.json({ error: "登录已过期，请重新登录" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor") || null;
  const limit = Number(searchParams.get("limit") || 20);
  try {
    const result = await listTransactions(auth.userId, { cursor, limit });
    return Response.json({
      transactions: result.items.map(serializeCreditTransaction),
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return creditErrorResponse(error, "读取积分明细失败");
  }
}

