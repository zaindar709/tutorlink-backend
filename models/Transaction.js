const mongoose = require('mongoose');
const crypto = require('crypto');

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateTransactionIdSuffix(length = 6) {
    const bytes = crypto.randomBytes(length);
    let suffix = '';
    for (let i = 0; i < length; i++) {
        suffix += ALPHANUMERIC[bytes[i] % ALPHANUMERIC.length];
    }
    return suffix;
}

function buildTransactionId() {
    return `TL-${generateTransactionIdSuffix(6)}`;
}

const transactionSchema = new mongoose.Schema({
    transactionId: {
        type: String,
        unique: true
    },
    walletId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Wallet',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['deposit', 'escrow_hold', 'escrow_release', 'escrow_refund', 'withdrawal'],
        required: true
    },
    direction: {
        type: String,
        enum: ['credit', 'debit'],
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 1
    },
    currency: {
        type: String,
        default: 'PKR'
    },
    title: {
        type: String,
        required: true
    },
    paymentMethod: {
        type: String,
        enum: ['jazzcash', 'easypaisa', 'internal_transfer', null],
        default: null
    },
    phoneNumber: {
        type: String,
        default: null
    },
    recipientName: {
        type: String,
        default: null
    },
    bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        default: null
    },
    status: {
        type: String,
        enum: ['completed', 'pending', 'failed'],
        default: 'completed'
    },
    escrowStatus: {
        type: String,
        enum: ['held', 'released', 'refunded', 'disputed', null],
        default: null
    },
    disputeReason: {
        type: String,
        default: ''
    },
    disputeRaisedAt: {
        type: Date,
        default: null
    },
    adminNotes: {
        type: String,
        default: ''
    }
}, { timestamps: true });

transactionSchema.pre('save', async function () {
    if (this.transactionId) return;

    const Transaction = this.constructor;
    let unique = false;

    while (!unique) {
        const candidate = buildTransactionId();
        const existing = await Transaction.findOne({ transactionId: candidate }).select('_id');
        if (!existing) {
            this.transactionId = candidate;
            unique = true;
        }
    }
});

transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ walletId: 1, createdAt: -1 });
transactionSchema.index({ bookingId: 1 });
transactionSchema.index({ transactionId: 1 }, { unique: true });
transactionSchema.index({ type: 1, escrowStatus: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
