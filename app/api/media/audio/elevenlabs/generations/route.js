import { localizedRoute } from '@/lib/server/localizedRoute';
import { elevenlabsAudioRoutes } from '@/lib/media/server/audioRoutes';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = localizedRoute(elevenlabsAudioRoutes.listGenerations);
export const POST = localizedRoute(elevenlabsAudioRoutes.createGeneration);
