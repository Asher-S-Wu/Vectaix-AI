import { notFound, redirect } from 'next/navigation';
import { getCurrentUserWithAccess } from '@/lib/admin';
import { getLocale } from '@/lib/server/i18n';
import { translate } from '@/lib/shared/i18n.mjs';
import { userGuide } from '@/lib/server/help/user-guide';
import { adminGuide } from '@/lib/server/help/admin-guide';
import HelpCenter from '@/app/components/help/HelpCenter';

export async function generateMetadata() {
  return { title: translate(await getLocale(), '帮助文档 · 花卷', 'Help docs · Huajuan') };
}

export default async function HelpPage({ searchParams }) {
  const user = await getCurrentUserWithAccess();
  if (!user) redirect('/');

  const params = await searchParams;
  const sections = user.isAdmin ? [...adminGuide, ...userGuide] : userGuide;
  const initialSection = params.section ?? sections[0].id;
  const returnTo = params.returnTo ?? '/';
  if (!sections.some(section => section.id === initialSection)) notFound();
  if (!['/', '/media', '/media/image', '/media/audio'].includes(returnTo)) notFound();

  return <HelpCenter sections={sections} initialSection={initialSection} isAdmin={user.isAdmin} returnTo={returnTo} />;
}
