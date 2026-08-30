import { getGuestModel } from "@/lib/shared/guestModels";
import { VIDEO_MODEL, VIDEO_MODEL_IDS } from "@/lib/media/shared/models";

function guestModelId(modelId) {
  return VIDEO_MODEL_IDS.includes(modelId) ? VIDEO_MODEL : modelId;
}

export function canAccessModel(auth, modelId) {
  if (!auth) return false;
  if (auth.kind === "member") return true;
  if (auth.kind !== "guest") return false;
  const id = guestModelId(modelId);
  return Boolean(getGuestModel(id) && auth.allowedModelIds?.includes(id));
}

function forbiddenModelResponse() {
  const message = "此模型尚未获得使用权限";
  return Response.json(
    { error: message, message, code: "GUEST_MODEL_FORBIDDEN" },
    { status: 403 },
  );
}

export function modelAccessResponse(auth, modelId) {
  return canAccessModel(auth, modelId) ? null : forbiddenModelResponse();
}

export function anyModelAccessResponse(auth, modelIds) {
  return modelIds.some((modelId) => canAccessModel(auth, modelId))
    ? null
    : forbiddenModelResponse();
}
