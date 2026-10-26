'use client';

import SpeechWorkspace from '@/app/components/media/SpeechWorkspace';
import { useMediaAccess } from '@/app/components/media/MediaShell';

export default function AudioPage() {
  const { capabilities } = useMediaAccess();
  return <SpeechWorkspace availability={capabilities} initialProvider={capabilities.defaultAudioProvider} />;
}
