import mongoose from 'mongoose';

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
    systemPrompts: [SystemPromptSchema],
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.models.UserSettings || mongoose.model('UserSettings', UserSettingsSchema);
