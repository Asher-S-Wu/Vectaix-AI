import { redirect } from 'next/navigation';
import { getCurrentUserWithAccess } from '@/lib/admin';
import AdminShell from '@/app/components/admin/AdminShell';

import { getLocale } from '@/lib/server/i18n';
import { translate } from '@/lib/shared/i18n.mjs';

export async function generateMetadata() {
  return { title: translate(await getLocale(), '管理后台 · 花卷', 'Admin · Huajuan') };
}

export default async function AdminLayout({ children }) {
  const user = await getCurrentUserWithAccess();
  if (!user?.isAdmin) redirect('/');
  return <AdminShell email={user.email}>{children}</AdminShell>;
}
