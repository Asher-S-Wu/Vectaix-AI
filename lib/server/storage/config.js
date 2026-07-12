import path from "node:path";

export function getStorageRoot() {
  const configured = String(process.env.STORAGE_ROOT || "").trim();
  if (!configured) {
    throw new Error("缺少 STORAGE_ROOT 环境变量");
  }
  return path.resolve(configured);
}

export function getStorageFilesRoot() {
  return path.join(getStorageRoot(), "files");
}
