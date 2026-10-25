import { localizedRoute } from '@/lib/server/localizedRoute';
import { readBody } from '@/lib/server/workbench/apiHelpers';
import { adminSkillsRoute } from '@/lib/server/skills/adminRoute';
import { setManagedSkillEnabled, deleteManagedSkill } from '@/lib/server/skills/service';

export const runtime = 'nodejs';
function PATCHHandler(request, { params }) { return adminSkillsRoute(request, async () => setManagedSkillEnabled((await params).id, (await readBody(request)).enabled)); }
function DELETEHandler(request, { params }) { return adminSkillsRoute(request, async () => deleteManagedSkill((await params).id)); }

export const PATCH = localizedRoute(PATCHHandler);
export const DELETE = localizedRoute(DELETEHandler);
