import { getAuthPayload } from "@/lib/auth";
import { fetchPrivateBlob } from "@/lib/server/blob";
import { isPrivateBlobUrl } from "@/lib/media/storage";

export async function GET(request) {
  const auth = await getAuthPayload();
  if (!auth) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const blobUrl = new URL(request.url).searchParams.get("url") || "";

  if (!blobUrl || !isPrivateBlobUrl(blobUrl)) {
    return Response.json({ error: "缺少或非法的媒体地址" }, { status: 400 });
  }

  try {
    const result = await fetchPrivateBlob(blobUrl);

    if (!result.ok) {
      return new Response("Not found", { status: result.status });
    }

    return new Response(result.body, {
      headers: {
        "Content-Type": result.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": "private, max-age=0, must-revalidate",
        ETag: result.headers.get("etag") || "",
      },
    });
  } catch (error) {
    console.error("[Media] read media blob:", error);
    return Response.json({ error: "读取媒体失败" }, { status: 500 });
  }
}
