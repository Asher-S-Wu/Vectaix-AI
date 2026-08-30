import {
  invalidJsonResponse,
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  addUserPrompt,
  deleteUserPrompt,
  getUserSettings,
  updateUserProfileSettings,
  updateUserPrompt,
} from "@/lib/server/settings/service";

async function requireUser(req) {
  const auth = await requireUserRecord({ request: req, connectDb: true, select: null });
  return auth?.payload || null;
}

export async function GET(req) {
  const user = await requireUser(req);
  if (!user) return unauthorizedResponse();

  const settings = await getUserSettings(user.userId);
  return Response.json({ settings });
}

export async function POST(req) {
  const user = await requireUser(req);
  if (!user) return unauthorizedResponse();

  const parsed = await parseJsonRequest(req);
  if (!parsed.ok) return invalidJsonResponse();

  try {
    const settings = await addUserPrompt(user.userId, parsed.body || {});
    return Response.json({ settings });
  } catch (error) {
    return Response.json({ error: error?.message || "保存失败" }, { status: 400 });
  }
}

export async function DELETE(req) {
  const user = await requireUser(req);
  if (!user) return unauthorizedResponse();

  const parsed = await parseJsonRequest(req);
  if (!parsed.ok) return invalidJsonResponse();

  try {
    const settings = await deleteUserPrompt(user.userId, parsed.body?.promptId);
    return Response.json({ settings });
  } catch (error) {
    const status = error?.message === "Settings not found" || error?.message === "Prompt not found" ? 404 : 400;
    return Response.json({ error: error?.message || "删除失败" }, { status });
  }
}

export async function PUT(req) {
  const user = await requireUser(req);
  if (!user) return unauthorizedResponse();

  const parsed = await parseJsonRequest(req);
  if (!parsed.ok) return invalidJsonResponse();

  try {
    const settings = await updateUserProfileSettings(user.userId, parsed.body || {});
    return Response.json({ settings });
  } catch (error) {
    return Response.json({ error: error?.message || "更新失败" }, { status: 400 });
  }
}

export async function PATCH(req) {
  const user = await requireUser(req);
  if (!user) return unauthorizedResponse();

  const parsed = await parseJsonRequest(req);
  if (!parsed.ok) return invalidJsonResponse();

  try {
    const settings = await updateUserPrompt(user.userId, parsed.body || {});
    return Response.json({ settings });
  } catch (error) {
    const status = error?.message === "Settings not found" || error?.message === "Prompt not found" ? 404 : 400;
    return Response.json({ error: error?.message || "更新失败" }, { status });
  }
}
