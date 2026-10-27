import { ELEVENLABS_AUDIO_DEFAULTS } from '../../lib/media/shared/elevenlabsAudio.js';
import test from 'node:test';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';

// Provider requests are mocked by these tests; keep DNS deterministic too.
test.beforeEach(t => {
  const lookup = dns.lookup;
  t.mock.method(dns, 'lookup', async () => [{ address: '1.1.1.1', family: 4 }]);
  syncBuiltinESMExports();
  t.after(() => { dns.lookup = lookup; syncBuiltinESMExports(); });
});

const { default: MediaSettings } = await import('../../models/MediaSettings.js');
import { encryptSecret } from '../../lib/server/security/secrets.mjs';

export async function seedMediaSettings({ imageKey = 'test-image-key', audioKey = 'test-elevenlabs-key' } = {}) {
  process.env.APP_SECRETS_KEY ||= Buffer.alloc(32, 17).toString('base64');
  await MediaSettings.updateOne({ _id: 'media' }, { $set: {
    image: { enabled: true, baseUrl: 'https://www.micuapi.ai/v1/images', model: 'gpt-image-2.5-sunburst', size: '1024x1024', quality: 'low', count: 1, encryptedApiKey: encryptSecret(imageKey, 'media:image') },
    audio: { ...ELEVENLABS_AUDIO_DEFAULTS, enabled: true, voiceId: '933563129e564b19a115bedd57b7406a', encryptedApiKey: encryptSecret(audioKey, 'media:audio') },
  } }, { upsert: true });
}
