import { redirect } from 'next/navigation';
import { getCurrentUserWithAccess } from '@/lib/admin';
import SettingsCenter from '@/app/components/settings/SettingsCenter';
import { getLocale } from '@/lib/server/i18n';
import { translate } from '@/lib/shared/i18n.mjs';

export async function generateMetadata() {
  return { title: translate(await getLocale(), '设置 · 花卷', 'Settings · Huajuan') };
}

export default async function SettingsPage({ searchParams }) {
  const user = await getCurrentUserWithAccess();
  if (!user) redirect('/');
  const params = await searchParams;
  return <SettingsCenter user={user} initialSection={params.section || 'general'} conversationId={params.conversationId || null} projectId={params.projectId || null} />;
}
