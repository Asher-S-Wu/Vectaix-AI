'use client';

import ImageWorkspace from '@/app/components/media/ImageWorkspace';
import { MediaServiceNotice, useMediaAccess } from '@/app/components/media/MediaShell';

export default function ImagePage() {
  const { capabilities } = useMediaAccess();
  return <><MediaServiceNotice enabled={capabilities.image} /><ImageWorkspace serviceEnabled={capabilities.image} /></>;
}
