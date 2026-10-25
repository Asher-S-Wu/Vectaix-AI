import { clientText, getClientLocale } from "@/lib/shared/i18n.mjs";
import { localizeMessage } from "@/lib/shared/systemMessages.mjs";

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
  const error = new Error(localizeMessage(String(message), getClientLocale()));
  error.status = response.status;
  error.payload = payload;
  return error;
}

export async function apiRequest(path, init = {}) {
  let response;
  try { response = await fetch(path, init); }
  catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error(clientText('网络连接失败，请检查网络后重试。', 'Could not connect. Check your network and try again.'), { cause: error });
  }
  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    throw buildApiError(response, payload, clientText("请求失败（{status}）", "Request failed ({status}).", { status: response.status }));
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
