import { redirect } from 'next/navigation';
import { getCurrentUserWithAccess } from '@/lib/admin';
import { getLocale } from '@/lib/server/i18n';
import { translate } from '@/lib/shared/i18n.mjs';

export async function generateMetadata() {
  return { title: translate(await getLocale(), '设置 · 花卷', 'Settings · Huajuan') };
}

export default async function SettingsPage({ searchParams }) {
  const user = await getCurrentUserWithAccess();
  if (!user) redirect('/');
  const params = await searchParams;
  if (params.section === 'admin' && !user.isAdmin) redirect('/');
  return null;
}
