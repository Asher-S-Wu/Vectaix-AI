import { localizedRoute } from '@/lib/server/localizedRoute';
import { adminSkillsRoute } from '@/lib/server/skills/adminRoute';
import { updateManagedSkill } from '@/lib/server/skills/service';

export const runtime = 'nodejs';
function POSTHandler(request, { params }) { return adminSkillsRoute(request, async () => updateManagedSkill((await params).id)); }

export const POST = localizedRoute(POSTHandler);
