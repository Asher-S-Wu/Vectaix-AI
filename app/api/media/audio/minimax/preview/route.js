import { localizedRoute } from '@/lib/server/localizedRoute';
import { minimaxAudioRoutes } from '@/lib/media/server/audioRoutes';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = localizedRoute(minimaxAudioRoutes.previewVoice);
