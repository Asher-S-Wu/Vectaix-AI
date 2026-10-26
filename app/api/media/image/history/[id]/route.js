import StoredFile from '@/models/StoredFile';
import { localizedRoute } from '@/lib/server/localizedRoute';
import { workbenchRoute, workbenchError } from '@/lib/server/workbench/apiHelpers';
import { withProjectLock } from '@/lib/server/workbench/projectLock';
import { assertStoredFilesUnreferenced } from '@/lib/server/storage/references';
import { deleteStoredFileDocument } from '@/lib/server/storage/service';
import { assertMediaWriteLeaseActive, beginMediaWriteLease, endMediaWriteLease } from '@/lib/media/server/userOperationLeases';

function DELETEHandler(request, context) {
  return workbenchRoute(request, async userId => {
    const { id } = await context.params;
    const lease = await beginMediaWriteLease(userId);
    try {
      return await withProjectLock(userId, 'task-creation', async () => {
        const file = await StoredFile.findOne({ userId, fileId: id, ownerType: 'image-result' });
        if (!file) throw workbenchError('图片记录不存在', 404);
        await assertStoredFilesUnreferenced(userId, [file]);
        await assertMediaWriteLeaseActive(lease);
        await deleteStoredFileDocument(file);
        return Response.json({ success: true });
      });
    } finally { await endMediaWriteLease(lease); }
  });
}

export const DELETE = localizedRoute(DELETEHandler);
