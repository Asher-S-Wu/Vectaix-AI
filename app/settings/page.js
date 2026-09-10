import { redirect } from 'next/navigation';
import { getCurrentUserWithAccess } from '@/lib/admin';
import SettingsCenter from '@/app/components/settings/SettingsCenter';

export default async function SettingsPage({ searchParams }) {
  const user = await getCurrentUserWithAccess();
  if (!user) redirect('/');
  const params = await searchParams;
  return <SettingsCenter user={user} initialSection={params.section || 'general'} conversationId={params.conversationId || null} projectId={params.projectId || null} />;
}
