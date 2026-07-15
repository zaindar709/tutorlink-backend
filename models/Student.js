const mongoose = require('mongoose');
const crypto = require('crypto');

function generatePublicIdSuffix() {
    const digits = crypto.randomInt(0, 10000);
    return String(digits).padStart(4, '0');
}

function buildPublicId() {
    return `TL-${generatePublicIdSuffix()}`;
}

const certificateSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    issuer: {
        type: String,
        default: ''
    },
    issuedAt: {
        type: Date,
        default: Date.now
    },
    documentUrl: {
        type: String,
        default: ''
    }
}, { _id: true });

const studentSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    publicId: {
        type: String,
        unique: true,
        sparse: true
    },
    grade: {
        type: String,
        default: ''
    },
    board: {
        type: String,
        default: ''
    },
    subjects: [String],
    interests: {
        type: [String],
        default: []
    },
    certificates: {
        type: [certificateSchema],
        default: []
    }
}, { timestamps: true });

studentSchema.pre('save', async function () {
    if (this.publicId) return;

    const Student = this.constructor;
    let unique = false;

    while (!unique) {
        const candidate = buildPublicId();
        const existing = await Student.findOne({ publicId: candidate }).select('_id');
        if (!existing) {
            this.publicId = candidate;
            unique = true;
        }
    }
});

studentSchema.index({ user: 1 }, { unique: true });

module.exports = mongoose.model('Student', studentSchema);
