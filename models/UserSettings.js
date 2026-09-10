import mongoose from 'mongoose';
import { DEFAULT_ASSISTANT, DEFAULT_APPEARANCE, DEFAULT_PERMISSIONS } from '@/lib/shared/preferences.mjs';

const SystemPromptSchema = new mongoose.Schema({
    name: { type: String, required: true },
    content: { type: String, required: true }
});

const UserSettingsSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    avatarFileId: {
        type: String,
        default: null
    },
    nickname: {
        type: String,
        default: ''
    },
    chatSystemPrompt: {
        type: String,
        default: ''
    },
    chatMediaSettings: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    systemPrompts: [SystemPromptSchema],
    skillsInitialized: { type: Boolean, default: false },
    memoryEnabled: { type: Boolean, default: true },
    assistant: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...DEFAULT_ASSISTANT }) },
    appearance: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...DEFAULT_APPEARANCE }) },
    permissions: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...DEFAULT_PERMISSIONS }) },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, { minimize: false });

export default mongoose.models.UserSettings || mongoose.model('UserSettings', UserSettingsSchema);
