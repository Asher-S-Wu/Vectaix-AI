import { localizedRoute } from '@/lib/server/localizedRoute';
import { elevenlabsAudioRoutes } from '@/lib/media/server/audioRoutes';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = localizedRoute(elevenlabsAudioRoutes.deleteGeneration);
