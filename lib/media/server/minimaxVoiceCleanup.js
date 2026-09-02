import dbConnect from "@/lib/db";
import {
  deleteMinimaxVoice,
  isMissingMinimaxVoiceError,
} from "@/lib/media/server/minimaxAudio";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";
import MinimaxVoice from "@/models/MinimaxVoice";

const STALE_SUBMISSION_MS = 30 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 50;

function safeErrorDetails(error) {
  return {
    errorType: /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error?.name || "")
      ? error.name
      : "Error",
    code: /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code || "")
      ? error.code
      : "INTERNAL_ERROR",
  };
}

async function markStaleSubmissionForCleanup(voice, cutoff) {
  if (voice.status === "CLEANUP_PENDING") return voice;
  return MinimaxVoice.findOneAndUpdate(
    {
      _id: voice._id,
      status: "SUBMITTING",
      updatedAt: voice.updatedAt,
      createdAt: { $lte: cutoff },
    },
    { $set: { status: "CLEANUP_PENDING" } },
    { new: true, runValidators: true },
  ).lean();
}

export async function reconcileMinimaxVoiceCleanup(now = new Date()) {
  await dbConnect();
  const cutoff = new Date(now.getTime() - STALE_SUBMISSION_MS);
  const voices = await MinimaxVoice.find({
    $or: [
      { status: "CLEANUP_PENDING" },
      { status: "SUBMITTING", createdAt: { $lte: cutoff } },
    ],
  })
    .sort({ updatedAt: 1, _id: 1 })
    .limit(CLEANUP_BATCH_SIZE)
    .lean();

  const result = { scanned: voices.length, removed: 0, retained: 0 };
  for (const candidate of voices) {
    const voice = await markStaleSubmissionForCleanup(candidate, cutoff);
    if (!voice) continue;
    try {
      await deleteMinimaxVoice(voice.voiceId);
    } catch (error) {
      if (!isMissingMinimaxVoiceError(error)) {
        result.retained += 1;
        console.error("[MiniMax Audio] cleanup pending remote voice:", {
          profileId: voice.profileId,
          ...safeErrorDetails(error),
        });
        continue;
      }
    }
    try {
      await deleteStoredFilesByOwner({
        userId: voice.userId,
        ownerType: "voice-profile",
        ownerId: voice.profileId,
      });
      const removed = await MinimaxVoice.deleteOne({
        _id: voice._id,
        status: "CLEANUP_PENDING",
      });
      if (removed.deletedCount === 1) result.removed += 1;
    } catch (error) {
      result.retained += 1;
      console.error("[MiniMax Audio] cleanup pending local voice:", {
        profileId: voice.profileId,
        ...safeErrorDetails(error),
      });
    }
  }
  return result;
}
