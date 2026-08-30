import { endCurrentAuthSession, hasGuestRequestContext } from '@/lib/auth';
import { getCurrentUserWithAccess } from '@/lib/admin';

export async function GET(request) {
  const user = await getCurrentUserWithAccess(request);
  if (!user) return Response.json({ user: null });

  return Response.json({
    user: {
      id: user.userId,
      email: user.email,
      isAdmin: user.isAdmin,
      isAdvancedUser: user.isAdvancedUser,
    }
  });
}

export async function DELETE(request) {
    if (await hasGuestRequestContext(request)) {
        return Response.json({ error: '游客空间不能退出普通账号' }, { status: 403 });
    }
    await endCurrentAuthSession();
    return Response.json({ success: true });
}
