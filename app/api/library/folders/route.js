import { localizedRoute } from '@/lib/server/localizedRoute';
import FileFolder from '@/models/FileFolder';
import { workbenchRoute, readBody, textField } from '@/lib/server/workbench/apiHelpers';
import { requireFolder } from '@/lib/server/files/service';
import { withProjectLock } from '@/lib/server/workbench/projectLock';
function POSTHandler(req) {
  return workbenchRoute(req, async userId => {
    const body = await readBody(req);
    return withProjectLock(userId, 'folders', async () => {
      const parent = await requireFolder(userId, body.parentId);
      return Response.json({ folder: await FileFolder.create({ userId, parentId: parent?._id || null, name: textField(body.name, '文件夹名称', 200, true) }) });
    });
  });
}

export const POST = localizedRoute(POSTHandler);
