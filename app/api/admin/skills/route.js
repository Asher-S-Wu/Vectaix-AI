import { localizedRoute } from '@/lib/server/localizedRoute';
import { readBody } from '@/lib/server/workbench/apiHelpers';
import { adminSkillsRoute } from '@/lib/server/skills/adminRoute';
import { listManagedSkills, installManagedSkills } from '@/lib/server/skills/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function GETHandler(request) { return adminSkillsRoute(request, listManagedSkills); }
function POSTHandler(request) { return adminSkillsRoute(request, async () => installManagedSkills(await readBody(request))); }

export const GET = localizedRoute(GETHandler);
export const POST = localizedRoute(POSTHandler);
