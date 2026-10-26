import mongoose from 'mongoose';
import StoredFile from '@/models/StoredFile';
import { serializeStoredFile } from '@/lib/server/storage/service';
import { localizedRoute } from '@/lib/server/localizedRoute';
import { workbenchRoute, workbenchError } from '@/lib/server/workbench/apiHelpers';

function GETHandler(request) {
  return workbenchRoute(request, async userId => {
    const cursor = new URL(request.url).searchParams.get('cursor');
    if (cursor && !mongoose.isValidObjectId(cursor)) throw workbenchError('图片记录游标无效');
    const records = await StoredFile.find({ userId, ownerType: 'image-result', ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(25).lean();
    const page = records.slice(0, 24);
    return Response.json({ images: page.map(record => ({ ...serializeStoredFile(record), createdAt: record.createdAt })), nextCursor: records.length > 24 ? String(page.at(-1)._id) : null });
  });
}

export const GET = localizedRoute(GETHandler);
