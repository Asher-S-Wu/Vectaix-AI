import { localizedRoute } from '@/lib/server/localizedRoute';
import { requireUserRecord, unauthorizedResponse } from '@/lib/server/api/routeHelpers';
import { getPublicModels } from '@/lib/server/models/service';
import { modelApiError } from '@/lib/server/models/api';
export const dynamic='force-dynamic';
async function GETHandler(request) {
  try {
    if (!await requireUserRecord({request})) return unauthorizedResponse();
    return Response.json(await getPublicModels(),{headers:{'Cache-Control':'no-store'}});
  } catch(error) { return modelApiError(error); }
}

export const GET = localizedRoute(GETHandler);
