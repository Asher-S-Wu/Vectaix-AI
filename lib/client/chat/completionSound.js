let completionSoundUnlocked = false;
let completionSoundUnlocking = false;
let completionSoundContext = null;
let completionSoundBuffer = null;
let completionSoundBufferPromise = null;

function getCompletionSoundContext() {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext;
  if (!AudioCtx) return null;
  if (!completionSoundContext || completionSoundContext.state === "closed") {
    completionSoundContext = new AudioCtx();
  }
  return completionSoundContext;
}

async function loadCompletionSoundBuffer() {
  if (completionSoundBuffer) return completionSoundBuffer;
  if (completionSoundBufferPromise) return completionSoundBufferPromise;

  const ctx = getCompletionSoundContext();
  if (!ctx) return null;

  completionSoundBufferPromise = fetch("/audio/staplebops-01.aac")
    .then((res) => res.arrayBuffer())
    .then((buf) => {
      if (typeof ctx.decodeAudioData !== "function") return null;
      const decoded = ctx.decodeAudioData(buf);
      if (decoded && typeof decoded.then === "function") return decoded;
      return new Promise((resolve, reject) => {
        ctx.decodeAudioData(buf, resolve, reject);
      });
    })
    .then((decoded) => {
      if (decoded) completionSoundBuffer = decoded;
      return completionSoundBuffer;
    })
    .catch(() => null)
    .finally(() => {
      completionSoundBufferPromise = null;
    });

  return completionSoundBufferPromise;
}

export function unlockCompletionSound() {
  if (completionSoundUnlocked || completionSoundUnlocking) return;
  const ctx = getCompletionSoundContext();
  if (!ctx) return;

  completionSoundUnlocking = true;
  const attempt = typeof ctx.resume === "function" ? ctx.resume() : null;
  if (attempt && typeof attempt.then === "function") {
    attempt
      .then(() => {
        completionSoundUnlocked = true;
        completionSoundUnlocking = false;
        loadCompletionSoundBuffer();
      })
      .catch(() => {
        completionSoundUnlocking = false;
      });
    return;
  }

  completionSoundUnlocked = true;
  completionSoundUnlocking = false;
  loadCompletionSoundBuffer();
}

export async function playCompletionSound(volume) {
  const rawVolume = Number(volume);
  if (!Number.isFinite(rawVolume) || rawVolume <= 0) return;

  const ctx = getCompletionSoundContext();
  if (!ctx) return;

  if (ctx.state === "suspended" && typeof ctx.resume === "function") {
    try {
      await ctx.resume();
    } catch {
      return;
    }
  }

  const normalized = Math.max(0, Math.min(1, rawVolume / 100));
  if (!completionSoundBuffer) {
    await loadCompletionSoundBuffer();
  }
  if (!completionSoundBuffer) return;

  try {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = normalized;
    source.buffer = completionSoundBuffer;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
  } catch { }
}
