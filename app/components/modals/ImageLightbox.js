"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Download, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toBlobDownloadUrl } from "@/lib/shared/blobUrls";

function isHttpUrl(src) {
  if (typeof src !== "string") return false;
  try {
    const u = new URL(src);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default function ImageLightbox({ open, onClose, src }) {
  const downloadUrl = useMemo(() => toBlobDownloadUrl(src), [src]);
  const canDownload = useMemo(() => isHttpUrl(src) && Boolean(downloadUrl), [downloadUrl, src]);

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
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/60" />

          <motion.div
            initial={{ scale: 0.98, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[90vw] max-h-[80vh] bg-black/30 rounded-2xl border border-white/10 shadow-2xl backdrop-blur"
          >
            <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
              {canDownload && (
                <a
                  href={downloadUrl}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white/90 bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg transition-colors"
                  title="下载原图"
                >
                  <Download size={14} />
                  下载
                </a>
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

            <div className="w-full h-full max-h-[80vh] flex items-center justify-center p-3">
              <img
                src={src}
                alt=""
                className="max-w-[90vw] max-h-[80vh] object-contain rounded-xl bg-black/40"
                draggable={false}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

