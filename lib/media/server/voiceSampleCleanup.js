import CustomVoice from "@/models/CustomVoice";
import StoredFile from "@/models/StoredFile";
import {
  deleteStoredFileDocument,
  deleteStoredFilesByIds,
} from "@/lib/server/storage/service";

const SAMPLE_MAX_AGE_MS = (24 * 60 - 15) * 60 * 1000;

export async function cleanupExpiredVoiceSamples(now = new Date(), userId = null) {
  const query = {
    sampleFileId: { $ne: null },
    sampleExpiresAt: { $lte: now },
    ...(userId ? { userId } : {}),
  };
  const voices = await CustomVoice.find(query)
    .select("_id userId profileId sampleFileId")
    .lean();

  let deleted = 0;
  for (const voice of voices) {
    await deleteStoredFilesByIds({
      userId: voice.userId,
      fileIds: [voice.sampleFileId],
      ownerType: "voice-profile",
      ownerId: voice.profileId,
    });
    const result = await CustomVoice.updateOne(
      { _id: voice._id, sampleFileId: voice.sampleFileId },
      {
        $set: {
          sampleFileId: null,
          sampleFileName: "",
          sampleTokenHash: null,
          sampleTokenExpiresAt: null,
          sampleExpiresAt: null,
        },
      },
    );
    deleted += result.modifiedCount;
  }

  const cutoff = new Date(now.getTime() - SAMPLE_MAX_AGE_MS);
  const expiredFiles = await StoredFile.find({
    kind: "voice-sample",
    ownerType: "voice-profile",
    createdAt: { $lte: cutoff },
    ...(userId ? { userId } : {}),
  });
  for (const file of expiredFiles) {
    await deleteStoredFileDocument(file);
    await CustomVoice.updateMany(
      { userId: file.userId, sampleFileId: file.fileId },
      {
        $set: {
          sampleFileId: null,
          sampleFileName: "",
          sampleTokenHash: null,
          sampleTokenExpiresAt: null,
          sampleExpiresAt: null,
        },
      },
    );
    deleted += 1;
  }
  return deleted;
}
