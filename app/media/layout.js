import { redirect } from 'next/navigation';
import { getCurrentUserWithAccess } from '@/lib/admin';
import MediaShell from '@/app/components/media/MediaShell';
import { getLocale } from '@/lib/server/i18n';
import { translate } from '@/lib/shared/i18n.mjs';

export async function generateMetadata() { return { title: translate(await getLocale(), 'Media 创作 · 花卷', 'Media studio · Huajuan') }; }

export default async function MediaLayout({ children }) {
  const user = await getCurrentUserWithAccess();
  if (!user) redirect('/');
  return <MediaShell user={user}>{children}</MediaShell>;
}
