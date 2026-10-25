import { getMediaConnection } from '@/lib/server/media/settings';

export async function resolveMicuImageConfig() {
  const { apiKey, baseUrl } = await getMediaConnection('image');
  return { apiKey, endpoint: `${baseUrl}/generations`, editEndpoint: `${baseUrl}/edits` };
}

export async function resolveFishAudioConfig() {
  const { apiKey, baseUrl } = await getMediaConnection('audio');
  return { apiKey, baseUrl };
}
