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

async function saveImageResult(response, { userId, ownerType, ownerId, signal }) {
  const item = response.data?.[0];
  const b64 = item?.b64_json;
  const remoteUrl = item?.url;

  if (typeof b64 === "string" && b64) {
    return saveImageBuffer({
      userId,
      input: Buffer.from(b64, "base64"),
      mimeType: "image/png",
      ownerType,
      ownerId,
    });
  }

  if (typeof remoteUrl === "string" && remoteUrl) {
    return saveMediaFromUrl({
      userId,
      url: remoteUrl,
      mimeType: "image/png",
      ownerType,
      ownerId,
      signal,
    });
  }

  throw new Error("图片处理失败，未返回有效结果");
}

export async function generateAndStoreImage({
  userId,
  prompt,
  size = "1024x1024",
  signal,
}) {
  const saved = await generateAndStoreImageFile({
    userId,
    prompt,
    size,
    ownerType: "image-result",
    ownerId: userId,
    signal,
  });
  return saved.url;
}

export async function generateAndStoreImageFile({
  userId,
  prompt,
  size = "1024x1024",
  ownerType,
  ownerId,
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

  return saveImageResult(response, { userId, ownerType, ownerId, signal });
}

export async function editAndStoreImage({
  userId,
  prompt,
  image,
  size = "1024x1024",
  signal,
}) {
  const saved = await editAndStoreImageFile({
    userId,
    prompt,
    image,
    size,
    ownerType: "image-result",
    ownerId: userId,
    signal,
  });
  return saved.url;
}

export async function editAndStoreImageFile({
  userId,
  prompt,
  image,
  size = "1024x1024",
  ownerType,
  ownerId,
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

  return saveImageResult(response, { userId, ownerType, ownerId, signal });
}
