import { endCurrentAuthSession } from '@/lib/auth';
import { getCurrentUserWithAccess } from '@/lib/admin';
import { getCreditSummary } from '@/lib/server/credits/service';

export async function GET(request) {
  const user = await getCurrentUserWithAccess(request);
  if (!user) return Response.json({ user: null });
  const credit = await getCreditSummary(user.userId);

  return Response.json({
    credit,
    user: {
      id: user.userId,
      email: user.email,
      isAdmin: user.isAdmin,
      isAdvancedUser: user.isAdvancedUser,
      credit,
    }
  });
}

export async function DELETE() {
    await endCurrentAuthSession();
    return Response.json({ success: true });
}
