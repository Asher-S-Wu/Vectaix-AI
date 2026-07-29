import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: [true, 'Please provide an email'],
        unique: true,
    },
    password: {
        type: String,
        required: [true, 'Please provide a password'],
    },
    isAdvancedUser: {
        type: Boolean,
        default: false,
    },
    deletionInProgress: {
        type: Boolean,
        default: false,
    },
    deletionStartedAt: {
        type: Date,
        default: null,
    },
    deletionCleanupLeaseId: {
        type: String,
        default: null,
    },
    deletionCleanupLeaseExpiresAt: {
        type: Date,
        default: null,
    },
    mediaWriteLeases: {
        type: [{
            _id: false,
            leaseId: {
                type: String,
                required: true,
            },
            expiresAt: {
                type: Date,
                required: true,
            },
        }],
        default: [],
    },
    voiceCreationLeaseId: {
        type: String,
        default: null,
    },
    voiceCreationLeaseExpiresAt: {
        type: Date,
        default: null,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

export default mongoose.models.User || mongoose.model('User', UserSchema);
