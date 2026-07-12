const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "weba"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v"]);

const MIME_BY_EXTENSION = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  weba: "audio/webm",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4v: "video/x-m4v",
});

function startsWith(buffer, bytes, offset = 0) {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function ascii(buffer, start, end) {
  return buffer.subarray(start, end).toString("ascii");
}

function matchesImage(buffer, extension) {
  if (extension === "jpg" || extension === "jpeg") {
    return startsWith(buffer, [0xff, 0xd8, 0xff]);
  }
  if (extension === "png") {
    return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (extension === "gif") {
    return ascii(buffer, 0, 6) === "GIF87a" || ascii(buffer, 0, 6) === "GIF89a";
  }
  if (extension === "webp") {
    return ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WEBP";
  }
  return false;
}

function matchesAudio(buffer, extension) {
  if (extension === "mp3") {
    return ascii(buffer, 0, 3) === "ID3"
      || (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  }
  if (extension === "wav") {
    return ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WAVE";
  }
  if (extension === "aac") {
    return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
  }
  if (extension === "ogg") return ascii(buffer, 0, 4) === "OggS";
  if (extension === "weba") return startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
  if (extension === "m4a") return ascii(buffer, 4, 8) === "ftyp";
  return false;
}

function matchesVideo(buffer, extension) {
  if (extension === "webm") return startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
  if (extension === "mp4" || extension === "mov" || extension === "m4v") {
    return ascii(buffer, 4, 8) === "ftyp";
  }
  return false;
}

export function inspectUploadedFile(input, extension) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const ext = String(extension || "").trim().toLowerCase();
  const mimeType = MIME_BY_EXTENSION[ext];
  if (!mimeType) return null;
  if (IMAGE_EXTENSIONS.has(ext) && matchesImage(buffer, ext)) {
    return { mimeType, category: "image" };
  }
  if (AUDIO_EXTENSIONS.has(ext) && matchesAudio(buffer, ext)) {
    return { mimeType, category: "audio" };
  }
  if (VIDEO_EXTENSIONS.has(ext) && matchesVideo(buffer, ext)) {
    return { mimeType, category: "video" };
  }
  return null;
}
