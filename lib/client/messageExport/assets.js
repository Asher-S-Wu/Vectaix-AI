let brandAssetsPromise = null;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("读取品牌图标失败"));
    reader.readAsDataURL(blob);
  });
}

export async function getBrandAssets() {
  if (!brandAssetsPromise) {
    brandAssetsPromise = (async () => {
      const response = await fetch("/icon", { cache: "force-cache" });
      if (!response.ok) {
        throw new Error("加载品牌图标失败");
      }
      const blob = await response.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const dataUrl = await blobToDataUrl(blob);
      return { bytes, dataUrl };
    })().catch((error) => {
      brandAssetsPromise = null;
      throw error;
    });
  }
  return brandAssetsPromise;
}
