const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    userType: {
        type: String,
        enum: ['Student', 'Tutor'],
        required: true
    },
    totalBalance: {
        type: Number,
        default: 0,
        min: 0
    },
    escrowBalance: {
        type: Number,
        default: 0,
        min: 0
    },
    currency: {
        type: String,
        default: 'PKR'
    }
}, { timestamps: true });

module.exports = mongoose.model('Wallet', walletSchema);
