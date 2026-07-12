import OpenAI from "openai";
import { resolveInfereraOpenAIConfig } from "@/lib/modelRoutes";
import { IMAGE_MODEL } from "@/lib/media/shared/models";
import { saveImageBuffer, saveMediaFromUrl } from "@/lib/media/storage";

function createInfereraOpenAIClient() {
  const { openAIBaseUrl, apiKey } = resolveInfereraOpenAIConfig();
  return new OpenAI({
    apiKey,
    baseURL: openAIBaseUrl,
  });
}

async function saveImageResult(response, { userId, signal }) {
  const item = response.data?.[0];
  const b64 = item?.b64_json;
  const remoteUrl = item?.url;

  if (typeof b64 === "string" && b64) {
    const saved = await saveImageBuffer({ userId, input: Buffer.from(b64, "base64"), mimeType: "image/png" });
    return saved.url;
  }

  if (typeof remoteUrl === "string" && remoteUrl) {
    const saved = await saveMediaFromUrl({ userId, url: remoteUrl, mimeType: "image/png", signal });
    return saved.url;
  }

  throw new Error("图片处理失败，未返回有效结果");
}

export async function generateAndStoreImage({
  userId,
  prompt,
  size = "1024x1024",
  signal,
}) {
  const client = createInfereraOpenAIClient();
  const response = await client.images.generate(
    {
      model: IMAGE_MODEL,
      prompt,
      n: 1,
      size,
    },
    { signal }
  );

  return saveImageResult(response, { userId, signal });
}

export async function editAndStoreImage({
  userId,
  prompt,
  image,
  size = "1024x1024",
  signal,
}) {
  const client = createInfereraOpenAIClient();
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

  return saveImageResult(response, { userId, signal });
}
