import OpenAI from "openai";
import { resolveZenMuxProviderConfig } from "@/lib/modelRoutes";
import { IMAGE_MODEL } from "@/lib/media/shared/models";
import { saveImageBuffer, saveMediaFromUrl } from "@/lib/media/storage";

function createZenMuxOpenAIClient() {
  const { openAIBaseUrl, apiKey } = resolveZenMuxProviderConfig();
  return new OpenAI({
    apiKey,
    baseURL: openAIBaseUrl,
  });
}

async function saveImageResult(response) {
  const item = response.data?.[0];
  const b64 = item?.b64_json;
  const remoteUrl = item?.url;

  if (typeof b64 === "string" && b64) {
    const saved = await saveImageBuffer(Buffer.from(b64, "base64"), "image/png");
    return saved.url;
  }

  if (typeof remoteUrl === "string" && remoteUrl) {
    const saved = await saveMediaFromUrl(remoteUrl, "image/png", "media-image");
    return saved.url;
  }

  throw new Error("图片处理失败，未返回有效结果");
}

export async function generateAndStoreImage({
  prompt,
  size = "1024x1024",
  signal,
}) {
  const client = createZenMuxOpenAIClient();
  const response = await client.images.generate(
    {
      model: IMAGE_MODEL,
      prompt,
      n: 1,
      size,
    },
    { signal }
  );

  return saveImageResult(response);
}

export async function editAndStoreImage({
  prompt,
  image,
  size = "1024x1024",
  signal,
}) {
  const client = createZenMuxOpenAIClient();
  const response = await client.images.edit(
    {
      model: IMAGE_MODEL,
      image,
      prompt,
      n: 1,
      size,
    },
    { signal }
  );

  return saveImageResult(response);
}
