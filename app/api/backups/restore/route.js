import { readMultipart } from '@/lib/server/files/uploads';
import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { restoreBackup } from '@/lib/server/backups/service';
export function POST(req) { return workbenchRoute(req, async userId => { const body = await readMultipart(req, 520*1024*1024); return Response.json(await restoreBackup(userId, body.get('file'), body.get('password'), { digest: body.get('digest'), applySettings: body.get('applySettings') === 'true' })); }); }
