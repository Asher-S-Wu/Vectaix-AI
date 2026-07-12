"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Download, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";

function isDownloadableUrl(src) {
  if (typeof src !== "string") return false;
  if (src.startsWith("/api/files/")) return true;
  try {
    const u = new URL(src);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function extractFilename(src) {
  try {
    const pathname = new URL(src).pathname;
    const name = pathname.split("/").pop();
    return name && /\.\w{2,4}$/.test(name) ? name : "image.png";
  } catch {
    return "image.png";
  }
}

export default function ImageLightbox({ open, onClose, src }) {
  const canDownload = isDownloadableUrl(src);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    if (!src || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = extractFilename(src);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(src, "_blank");
    } finally {
      setDownloading(false);
    }
  }, [src, downloading]);
  const [loadedImage, setLoadedImage] = useState(null);

  useEffect(() => {
    if (!open || !src) return;
    const img = new window.Image();
    img.onload = () => setLoadedImage({ src, w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
  }, [open, src]);

  const displayStyle = useMemo(() => {
    if (!loadedImage || loadedImage.src !== src) return {};
    const VW = window.innerWidth * 0.9;
    const VH = window.innerHeight * 0.8;
    const PAD = 24;
    const maxW = VW - PAD;
    const maxH = VH - PAD;
    const ratio = loadedImage.w / loadedImage.h;
    let w = loadedImage.w;
    let h = loadedImage.h;
    if (w > maxW) { w = maxW; h = w / ratio; }
    if (h > maxH) { h = maxH; w = h * ratio; }
    return { width: Math.round(w), height: Math.round(h) };
  }, [loadedImage, src]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-3"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/60" />

          <motion.div
            initial={{ scale: 0.98, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            style={displayStyle}
            className="relative flex items-center justify-center bg-black/30 rounded-2xl border border-white/10 shadow-2xl backdrop-blur overflow-hidden"
          >
            <div className="absolute top-2 right-2 flex items-center gap-2 z-10">
              {canDownload && (
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white/90 bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg transition-colors disabled:opacity-50"
                  title="下载原图"
                >
                  <Download size={14} />
                  {downloading ? "下载中…" : "下载"}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center w-9 h-9 text-white/85 hover:text-white bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg transition-colors"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>

            {src && (
              <Image
                src={src}
                alt=""
                width={loadedImage?.src === src ? loadedImage.w : 1200}
                height={loadedImage?.src === src ? loadedImage.h : 800}
                unoptimized
                className="block w-full h-full object-contain rounded-xl"
                draggable={false}
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
