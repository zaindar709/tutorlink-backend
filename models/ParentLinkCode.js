const mongoose = require('mongoose');
const crypto = require('crypto');

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_TTL_MINUTES = 20;

function generateLinkCode(length = 6) {
    const bytes = crypto.randomBytes(length);
    let code = '';
    for (let i = 0; i < length; i++) {
        code += ALPHANUMERIC[bytes[i] % ALPHANUMERIC.length];
    }
    return code;
}

const parentLinkCodeSchema = new mongoose.Schema({
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    studentUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    code: {
        type: String,
        unique: true,
        uppercase: true,
        trim: true
    },
    expiresAt: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'used', 'expired'],
        default: 'active'
    },
    usedByParent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Parent',
        default: null
    },
    usedAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

parentLinkCodeSchema.pre('save', async function () {
    const ParentLinkCode = this.constructor;

    if (!this.code) {
        let unique = false;
        while (!unique) {
            const candidate = generateLinkCode(6);
            const existing = await ParentLinkCode.findOne({ code: candidate }).select('_id');
            if (!existing) {
                this.code = candidate;
                unique = true;
            }
        }
    }

    if (!this.expiresAt) {
        this.expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
    }

    if (this.status === 'active' && this.expiresAt <= new Date()) {
        this.status = 'expired';
    }
});

parentLinkCodeSchema.index({ code: 1, status: 1 });
parentLinkCodeSchema.index({ student: 1, status: 1, createdAt: -1 });
parentLinkCodeSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, partialFilterExpression: { status: 'active' } }
);

module.exports = mongoose.model('ParentLinkCode', parentLinkCodeSchema);
