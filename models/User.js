import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: function requireMemberEmail() { return !this.guestLinkId; },
    },
    password: {
        type: String,
        required: function requireMemberPassword() { return !this.guestLinkId; },
    },
    guestLinkId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GuestLink',
        immutable: true,
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
}, { autoIndex: false });

UserSchema.index({ email: 1 }, {
    name: 'member_email_unique',
    unique: true,
    partialFilterExpression: { email: { $type: 'string' } },
});
UserSchema.index({ guestLinkId: 1 }, {
    name: 'guest_link_user_unique',
    unique: true,
    partialFilterExpression: { guestLinkId: { $type: 'objectId' } },
});
UserSchema.pre('validate', function validateGuestIdentity() {
    if (!this.guestLinkId) return;
    if (this.email !== undefined || this.password !== undefined) {
        this.invalidate('guestLinkId', '游客身份不能设置邮箱或密码');
    }
    if (this.isAdvancedUser) {
        this.invalidate('isAdvancedUser', '游客不能设置高级用户权限');
    }
});

export default mongoose.models.User || mongoose.model('User', UserSchema);
