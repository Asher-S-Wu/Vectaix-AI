import { localeTag } from "@/lib/shared/i18n.mjs";

export function normalizeExportText(content) {
  return String(content || "").replace(/\r\n/g, "\n").trim();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

export function buildFileName(extension, date) {
  const now = date || new Date();
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  return `huajuan-reply-${stamp}.${extension}`;
}

export function formatExportTime(date, locale) {
  return new Intl.DateTimeFormat(localeTag(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date || new Date());
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
