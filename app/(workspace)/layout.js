import ChatApp from '@/app/ChatApp';
import { getCurrentUserWithAccess } from '@/lib/admin';

export default async function WorkspaceLayout({ children }) {
  const user = await getCurrentUserWithAccess();
  const initialUser = user ? { id: user.userId, email: user.email, isAdmin: user.isAdmin } : null;
  return <><ChatApp initialUser={initialUser} />{children}</>;
}
