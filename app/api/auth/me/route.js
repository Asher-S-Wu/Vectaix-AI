import { endCurrentAuthSession } from '@/lib/auth';
import { getCurrentUserWithAccess } from '@/lib/admin';

export async function GET() {
  const user = await getCurrentUserWithAccess();
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

export async function DELETE() {
    await endCurrentAuthSession();
    return Response.json({ success: true });
}
