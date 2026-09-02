import mongoose from "mongoose";

const SessionSchema = new mongoose.Schema({
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
}, { timestamps: true });

SessionSchema.index({ userId: 1, expiresAt: 1 });

const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema);

export async function ensureSessionIndexes() {
  const collection = Session.collection;
  let indexes = [];
  try {
    indexes = await collection.indexes();
  } catch (error) {
    if (error?.code !== 26 && error?.codeName !== "NamespaceNotFound") throw error;
  }
  for (const index of indexes) {
    const fields = Object.keys(index.key || {});
    if (fields.includes("guestLinkId") || fields.includes("guestLinkRevision")) {
      await collection.dropIndex(index.name);
    }
  }
  await Session.createIndexes();
}

export default Session;
