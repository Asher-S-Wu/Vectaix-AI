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

export async function seedMediaSettings({ imageKey = 'test-image-key', audioKey = 'test-fish-key' } = {}) {
  process.env.APP_SECRETS_KEY ||= Buffer.alloc(32, 17).toString('base64');
  await MediaSettings.updateOne({ _id: 'media' }, { $set: {
    image: { enabled: true, baseUrl: 'https://www.micuapi.ai/v1/images', model: 'gpt-image-2.5-sunburst', size: '1024x1024', quality: 'low', count: 1, encryptedApiKey: encryptSecret(imageKey, 'media:image') },
    audio: { enabled: true, baseUrl: 'https://api.fish.audio', provider: 'fish', voiceId: '933563129e564b19a115bedd57b7406a', format: 'mp3', sampleRate: 44100, speed: 1, volume: 0, temperature: 0.7, topP: 0.7, encryptedApiKey: encryptSecret(audioKey, 'media:audio') },
  } }, { upsert: true });
}
