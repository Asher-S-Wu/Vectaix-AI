export const isHttpUrl = (src) => typeof src === "string" && /^https?:\/\//i.test(src);

export const isPrivateFileUrl = (src) => typeof src === "string" && src.startsWith("/api/files/");

export const isDataImageUrl = (src) => typeof src === "string" && /^data:image\//i.test(src);

export const isKeepableImageSrc = (src) => isHttpUrl(src) || isPrivateFileUrl(src) || isDataImageUrl(src);

export const getMessageImageSrc = (msg) => {
  if (Array.isArray(msg?.parts)) {
    for (const p of msg.parts) {
      const url = p?.inlineData?.url;
      if (typeof url === "string" && url) return url;
    }
  }
  return null;
};
