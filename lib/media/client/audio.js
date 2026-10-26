import { creditOperationHeaders } from "@/lib/client/credits/operations";
import { clientText } from "@/lib/shared/i18n.mjs";

export function createAudioClient(provider) {
  const BASE = `/api/media/audio/${provider}`;

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

  async function listVoices({ signal } = {}) {
    return (await request("/voices", { signal })).json();
  }

  async function createGeneration(input) {
    return (await request("/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...creditOperationHeaders() },
      body: JSON.stringify(input),
    })).json();
  }

  async function listGenerations() {
    return (await request("/generations")).json();
  }

  async function deleteGeneration(id) {
    return (await request(`/generations/${encodeURIComponent(id)}`, { method: "DELETE" })).json();
  }

  async function previewVoice(voiceId, { signal } = {}) {
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

  async function createVoice(form) {
    return (await request("/voices", { method: "POST", body: form })).json();
  }

  async function refreshVoice(id) {
    return (await request(`/voices/${encodeURIComponent(id)}`)).json();
  }

  async function deleteVoice(id) {
    return (await request(`/voices/${encodeURIComponent(id)}`, { method: "DELETE" })).json();
  }

  return { listVoices, createGeneration, listGenerations, deleteGeneration, previewVoice, createVoice, refreshVoice, deleteVoice };
}
