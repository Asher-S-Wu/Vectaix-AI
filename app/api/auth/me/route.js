import { localizedRoute } from '@/lib/server/localizedRoute';
import { endCurrentAuthSession } from '@/lib/auth';
import { getCurrentUserWithAccess } from '@/lib/admin';

async function GETHandler(request) {
  const user = await getCurrentUserWithAccess(request);
  if (!user) return Response.json({ user: null });

  return Response.json({

    user: {
      id: user.userId,
      email: user.email,
      isAdmin: user.isAdmin,

    }
  });
}

async function DELETEHandler() {
    await endCurrentAuthSession();
    return Response.json({ success: true });
}

export const GET = localizedRoute(GETHandler);
export const DELETE = localizedRoute(DELETEHandler);
