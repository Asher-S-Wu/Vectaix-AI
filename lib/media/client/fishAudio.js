import { creditOperationHeaders } from "@/lib/client/credits/operations";

const BASE = "/api/media/audio/fish";

async function request(path, init = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("网络连接失败，请稍后再试", { cause: error });
  }
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || data.error || "语音请求失败");
  }
  return response;
}

export async function listFishVoices({ query = "", page = 1, signal } = {}) {
  const search = new URLSearchParams({ query, page: String(page) });
  return (await request(`/voices?${search}`, { signal })).json();
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
  if (!blob.size) throw new Error("试听音频为空");
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
