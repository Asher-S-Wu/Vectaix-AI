import { requireAdmin } from "@/lib/admin";
import { forbiddenResponse } from "@/lib/server/api/routeHelpers";
import { creditErrorResponse } from "@/lib/server/credits/api";
import { getBillingSettings, updateBillingSettings } from "@/lib/server/credits/settings";

export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!await requireAdmin(request)) return forbiddenResponse();
  try {
    return Response.json({ settings: await getBillingSettings() });
  } catch (error) {
    return creditErrorResponse(error, "读取计费设置失败");
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
  try {
    const settings = await updateBillingSettings(body?.settings, {
      updatedBy: admin.userId,
      expectedVersion: body?.expectedVersion,
    });
    return Response.json({ success: true, settings });
  } catch (error) {
    return creditErrorResponse(error, "保存计费设置失败");
  }
}

