export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target?.result || null);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function convertImageFileToPng(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          const baseName = file.name.replace(/\.[^.]+$/, "");
          resolve(new File([blob], `${baseName}.png`, { type: "image/png" }));
        },
        "image/png",
        1.0
      );
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}
