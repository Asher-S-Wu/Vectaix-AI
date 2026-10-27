'use client';

import ImageWorkspace from '@/app/components/media/ImageWorkspace';
import { MediaServiceNotice, useMediaAccess } from '@/app/components/media/MediaShell';

export default function ImagePage() {
  const { capabilities } = useMediaAccess();
  return <div className="space-y-6"><MediaServiceNotice enabled={capabilities.image} /><ImageWorkspace serviceEnabled={capabilities.image} /></div>;
}
