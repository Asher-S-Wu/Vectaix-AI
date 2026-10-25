import mongoose from 'mongoose';
import UserSettings from '@/models/UserSettings';
import PlatformSettings from '@/models/PlatformSettings';
import MediaSettings from '@/models/MediaSettings';
import { DEFAULT_MODEL_SETTINGS } from '@/lib/server/models/config';
import { validateModelSettings } from '@/lib/server/models/service';
import { DEFAULT_MEDIA_SETTINGS } from '@/lib/server/media/settings';
import { DEFAULT_RATES } from '@/lib/server/credits/constants';
import { encryptSecret } from '@/lib/server/security/secrets.mjs';
import { DEFAULT_ASSISTANT, DEFAULT_APPEARANCE, DEFAULT_PERMISSIONS } from '@/lib/shared/preferences.mjs';

export async function migrateServiceCredentials() {
  const migrations = mongoose.connection.collection('settings_migrations');
  const migrationId = 'huajuan-service-credentials-v1';
  if (await migrations.findOne({ _id: migrationId })) return;

  const modelKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (modelKey) {
    await PlatformSettings.updateOne({ _id: 'platform' }, { $setOnInsert: { _id: 'platform' } }, { upsert: true });
    const settings = await PlatformSettings.findById('platform').lean();
    if (!settings.modelConfig) {
      const modelConfig = validateModelSettings({
        ...DEFAULT_MODEL_SETTINGS,
        baseUrl: 'https://api.deepseek.com', protocol: 'responses', modelId: 'deepseek-flash', displayName: '花卷',
        contextWindow: 1048576, maxOutputTokens: 393216, pricing: DEFAULT_RATES.chat['deepseek-flash'],
      });
      modelConfig.encryptedApiKey = encryptSecret(modelKey, 'platform:model');
      await PlatformSettings.updateOne({ _id: 'platform', modelConfig: null }, { $set: { modelConfig } });
    }
  }

  for (const [kind, envName] of Object.entries({ image: 'MICU_OPENAI_IMAGE_API_KEY', audio: 'FISH_API_KEY' })) {
    const apiKey = process.env[envName]?.trim();
    if (!apiKey) continue;
    await MediaSettings.updateOne({ _id: 'media' }, { $setOnInsert: { _id: 'media' } }, { upsert: true });
    const settings = await MediaSettings.findById('media').lean();
    if (settings[kind] && Object.keys(settings[kind]).length) continue;
    const value = { ...DEFAULT_MEDIA_SETTINGS[kind], enabled: true, encryptedApiKey: encryptSecret(apiKey, `media:${kind}`) };
    await MediaSettings.updateOne({ _id: 'media', $or: [{ [kind]: null }, { [kind]: {} }] }, { $set: { [kind]: value } });
  }
  await migrations.updateOne({ _id: migrationId }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true });
}

export async function migrateUserCapabilities() {
  const migrations = mongoose.connection.collection('settings_migrations');
  if (await migrations.findOne({ _id: 'huajuan-agent-v1' })) return;
  await mongoose.connection.collection('workbenchmemories').deleteMany({});
  await mongoose.connection.collection('backupschedules').updateMany({}, { $pull: { selection: { $in: ['skills', 'memories'] } } });
  await mongoose.connection.collection('backupschedules').updateMany({ selection: { $size: 0 } }, { $set: { enabled: false } });
  await mongoose.connection.collection('usersettings').updateMany({}, { $unset: {
    memoryEnabled: '', skillsInitialized: '', chatMediaSettings: '',
    'permissions.microphone': '', 'permissions.camera': '', 'permissions.clipboard': '', 'permissions.geolocation': '',
  } });
  await mongoose.connection.collection('workspaceprojects').updateMany({}, { $unset: { memoryEnabled: '' } });
  await mongoose.connection.collection('conversations').updateMany({}, { $unset: { 'settings.memoryEnabled': '', 'settings.disabledSkillIds': '' } });
  await UserSettings.updateMany({ 'assistant.name': 'Vectaix' }, { $set: { 'assistant.name': '花卷' } });
  for (const [field, value] of Object.entries({ assistant: DEFAULT_ASSISTANT, appearance: DEFAULT_APPEARANCE, permissions: DEFAULT_PERMISSIONS })) {
    await UserSettings.updateMany({ [field]: { $exists: false } }, { $set: { [field]: value } });
  }
  await migrations.updateOne({ _id: 'huajuan-agent-v1' }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true });
}
