import { getAuthPayload } from "@/lib/auth";
import { creditErrorResponse } from "@/lib/server/credits/api";
import { getCreditSummary } from "@/lib/server/credits/service";
import { getBillingSettings } from "@/lib/server/credits/settings";
import { getPublicCreditPricing } from "@/lib/server/credits/publicPricing";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await getAuthPayload(request);
  if (!auth) return Response.json({ error: "登录已过期，请重新登录" }, { status: 401 });
  try {
    const [credit, settings] = await Promise.all([
      getCreditSummary(auth.userId),
      getBillingSettings(),
    ]);
    return Response.json({ credit, pricing: getPublicCreditPricing(settings) });
  } catch (error) {
    return creditErrorResponse(error, "读取积分余额失败");
  }
}
