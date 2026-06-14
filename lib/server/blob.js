export function fetchPrivateBlob(blobUrl) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("缺少 BLOB_READ_WRITE_TOKEN 环境变量");
  }

  return fetch(blobUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}
