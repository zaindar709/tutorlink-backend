const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Transaction = require('../models/Transaction');
const Student = require('../models/Student');
const authMiddleware = require('../middleware/authMiddleware');

function sendError(res, status, message, code) {
    return res.status(status).json({ success: false, message, code });
}

async function findEscrowHoldTransaction(transactionId) {
    if (mongoose.Types.ObjectId.isValid(transactionId)) {
        const byId = await Transaction.findOne({ _id: transactionId, type: 'escrow_hold' });
        if (byId) return byId;
    }

    return Transaction.findOne({ transactionId, type: 'escrow_hold' });
}

async function canRaiseDispute(req, transaction) {
    const ownerUserId = transaction.userId.toString();

    if (req.user._id.toString() === ownerUserId) {
        return true;
    }

    if (req.user.role === 'parent') {
        const studentProfile = await Student.findOne({ user: transaction.userId });
        if (!studentProfile) return false;

        return Boolean(
            req.profile?.linkedStudents?.some(
                (id) => id.toString() === studentProfile._id.toString()
            )
        );
    }

    return false;
}

// POST /api/billing/disputes/raise
router.post('/disputes/raise', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'student' && req.user.role !== 'parent') {
            return sendError(res, 403, 'Only students or parents can raise disputes', 'FORBIDDEN');
        }

        const { transactionId, reason } = req.body;

        if (!transactionId || typeof transactionId !== 'string' || !transactionId.trim()) {
            return sendError(res, 400, 'transactionId is required', 'VALIDATION_ERROR');
        }

        if (!reason || typeof reason !== 'string' || !reason.trim()) {
            return sendError(res, 400, 'reason is required', 'VALIDATION_ERROR');
        }

        const transaction = await findEscrowHoldTransaction(transactionId.trim());

        if (!transaction) {
            return sendError(res, 404, 'Escrow transaction not found', 'NOT_FOUND');
        }

        const allowed = await canRaiseDispute(req, transaction);
        if (!allowed) {
            return sendError(res, 403, 'You are not allowed to raise a dispute on this transaction', 'FORBIDDEN');
        }

        if (transaction.escrowStatus !== 'held') {
            const stateMessages = {
                released: 'This payment has already been released to the tutor and cannot be disputed',
                refunded: 'This payment has already been refunded and cannot be disputed',
                disputed: 'A dispute has already been raised for this transaction'
            };

            const message = stateMessages[transaction.escrowStatus]
                || 'Only held escrow payments can be disputed';

            return sendError(res, 400, message, 'INVALID_ESCROW_STATE');
        }

        transaction.escrowStatus = 'disputed';
        transaction.disputeReason = reason.trim();
        transaction.disputeRaisedAt = new Date();
        await transaction.save();

        return res.status(200).json({
            success: true,
            message: 'Dispute raised successfully and sent to admin review',
            data: {
                transactionId: transaction.transactionId,
                escrowStatus: transaction.escrowStatus,
                disputeReason: transaction.disputeReason,
                disputeRaisedAt: transaction.disputeRaisedAt,
                amount: transaction.amount,
                currency: transaction.currency,
                bookingId: transaction.bookingId
            }
        });
    } catch (error) {
        console.error('Raise Dispute Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
});

module.exports = router;
