import crypto from 'node:crypto';
import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
    },
    password: {
        type: String,
        required: true,
    },
    isAdvancedUser: {
        type: Boolean,
        default: false,
    },
    creditBalance: {
        type: Number,
        min: 0,
        validate: Number.isSafeInteger,
        default: 0,
    },
    creditHeld: {
        type: Number,
        min: 0,
        validate: Number.isSafeInteger,
        default: 0,
    },
    creditHolds: {
        type: [{
            _id: false,
            operationId: { type: String, required: true, trim: true, maxlength: 200 },
            points: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
            createdAt: { type: Date, required: true },
        }],
        default: [],
    },
    creditSettlementReceipts: {
        type: [{
            _id: false,
            operationId: { type: String, required: true, trim: true, maxlength: 200 },
            kind: { type: String, required: true, enum: ['model_settlement', 'admin_set'] },
            balanceBefore: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
            balanceAfter: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
            creditVersionBefore: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
            creditVersionAfter: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
            appliedAt: { type: Date, required: true },
        }],
        default: [],
    },
    creditsInitializedAt: {
        type: Date,
    },
    creditVersion: {
        type: Number,
        min: 0,
        validate: Number.isSafeInteger,
        default: 0,
    },
    creditAuditKey: {
        type: String,
        required: true,
        immutable: true,
        default: () => crypto.randomUUID(),
    },
    creditLastOperationId: {
        type: String,
        trim: true,
        maxlength: 200,
        default: '',
    },
    creditInitializationOperationId: {
        type: String,
        trim: true,
        maxlength: 200,
        immutable: true,
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
}, { autoIndex: false });

UserSchema.index({ email: 1 }, {
    name: 'member_email_unique',
    unique: true,
});

export async function ensureUserIndexes() {
    const collection = User.collection;
    let indexes = [];
    try {
        indexes = await collection.indexes();
    } catch (error) {
        if (error?.code !== 26 && error?.codeName !== 'NamespaceNotFound') throw error;
    }
    const memberIndex = indexes.find((index) => index.name === 'member_email_unique');
    if (memberIndex && (memberIndex.partialFilterExpression || memberIndex.unique !== true)) {
        await collection.dropIndex('member_email_unique');
    }
    const obsoleteGuestIndex = indexes.find((index) => index.name === 'guest_link_user_unique');
    if (obsoleteGuestIndex) await collection.dropIndex(obsoleteGuestIndex.name);
    const obsoleteEmailIndex = indexes.find((index) => index.name === 'email_1');
    if (obsoleteEmailIndex) await collection.dropIndex(obsoleteEmailIndex.name);
    await collection.createIndex(
        { email: 1 },
        { name: 'member_email_unique', unique: true },
    );
}

const User = mongoose.models.User || mongoose.model('User', UserSchema);

export default User;
