export function toFileDownloadUrl(url) {
  if (typeof url !== "string" || !url.startsWith("/api/files/")) return null;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}download=1`;
}
