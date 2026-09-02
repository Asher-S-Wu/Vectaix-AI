import { notifyCreditFromPayload, notifyCreditFromResponseHeaders } from "@/lib/client/credits/events";

async function parseResponsePayload(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }
  return response.text().catch(() => null);
}

function buildApiError(response, payload, fallbackMessage) {
  const messageFromJson =
    payload && typeof payload === "object"
      ? payload.error || payload.message
      : "";
  const messageFromText = typeof payload === "string" ? payload : "";
  const message = messageFromJson || messageFromText || fallbackMessage || "请求失败";
  const error = new Error(String(message));
  error.status = response.status;
  error.payload = payload;
  return error;
}

export async function apiRequest(path, init = {}) {
  const response = await fetch(path, init);
  const payload = await parseResponsePayload(response);
  notifyCreditFromPayload(payload);
  notifyCreditFromResponseHeaders(response);

  if (!response.ok) {
    throw buildApiError(response, payload, `请求失败（${response.status}）`);
  }

  return payload;
}

export async function apiJson(path, { method = "GET", body, headers, ...rest } = {}) {
  const init = {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers || {}),
    },
    ...rest,
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  return apiRequest(path, init);
}
