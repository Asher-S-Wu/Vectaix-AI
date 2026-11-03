import { localizedRoute } from '@/lib/server/localizedRoute';
import { minimaxAudioRoutes } from '@/lib/media/server/audioRoutes';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = localizedRoute(minimaxAudioRoutes.listGenerations);
export const POST = localizedRoute(minimaxAudioRoutes.createGeneration);
