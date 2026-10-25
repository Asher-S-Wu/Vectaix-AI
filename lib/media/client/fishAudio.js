import { creditOperationHeaders } from "@/lib/client/credits/operations";
import { clientText } from "@/lib/shared/i18n.mjs";

const BASE = "/api/media/audio/fish";

async function request(path, init = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(clientText("网络连接失败，请稍后再试", "Connection failed. Please try again later."), { cause: error });
  }
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || data.error || clientText("语音请求失败", "The audio request failed"));
  }
  return response;
}

export async function listFishVoices({ signal } = {}) {
  return (await request("/voices", { signal })).json();
}

export async function createFishGeneration(input) {
  return (await request("/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...creditOperationHeaders() },
    body: JSON.stringify(input),
  })).json();
}

export async function listFishGenerations() {
  return (await request("/generations")).json();
}

export async function deleteFishGeneration(id) {
  return (await request(`/generations/${encodeURIComponent(id)}`, { method: "DELETE" })).json();
}

export async function previewFishVoice(voiceId, { signal } = {}) {
  const response = await request("/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...creditOperationHeaders() },
    body: JSON.stringify({ voiceId }),
    signal,
  });
  const blob = await response.blob();
  if (!blob.size) throw new Error(clientText("试听音频为空", "The voice preview is empty"));
  return URL.createObjectURL(blob);
}

export async function createFishVoice(form) {
  return (await request("/voices", { method: "POST", body: form })).json();
}

export async function refreshFishVoice(id) {
  return (await request(`/voices/${encodeURIComponent(id)}`)).json();
}

export async function deleteFishVoice(id) {
  return (await request(`/voices/${encodeURIComponent(id)}`, { method: "DELETE" })).json();
}
