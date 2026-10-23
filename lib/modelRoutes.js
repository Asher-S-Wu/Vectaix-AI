const MICU_IMAGE_BASE_URL = "https://www.micuapi.ai/v1/images";

export function resolveMicuImageConfig() {
  const apiKey = process.env.MICU_OPENAI_IMAGE_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(new Error("Micu 图片服务尚未配置，请联系管理员"), {
      status: 503,
      code: "SERVICE_NOT_CONFIGURED",
      requestId: undefined,
      upstreamRejected: false,
    });
  }
  return {
    apiKey,
    endpoint: `${MICU_IMAGE_BASE_URL}/generations`,
    editEndpoint: `${MICU_IMAGE_BASE_URL}/edits`,
  };
}

export function resolveFishAudioConfig() {
  const apiKey = process.env.FISH_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(new Error("Fish Audio 服务尚未配置，请在 Railway 环境变量中设置 FISH_API_KEY"), {
      status: 503,
      code: "SERVICE_NOT_CONFIGURED",
    });
  }
  return { apiKey, baseUrl: "https://api.fish.audio" };
}
