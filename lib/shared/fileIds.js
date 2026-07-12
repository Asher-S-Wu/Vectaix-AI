const FILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeFileId(value) {
  const fileId = typeof value === "string" ? value.trim().toLowerCase() : "";
  return FILE_ID_PATTERN.test(fileId) ? fileId : null;
}
