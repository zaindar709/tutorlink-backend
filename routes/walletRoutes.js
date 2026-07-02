const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Transaction = require('../models/Transaction');
const Student = require('../models/Student');
const authMiddleware = require('../middleware/authMiddleware');
const walletService = require('../services/walletService');
const { WalletServiceError } = require('../services/walletService');
const {
    formatTransactionAmount,
    formatTransactionTimestamp,
    formatPaymentMethodLabel
} = require('../utils/walletHelpers');

function sendError(res, status, message, code) {
    return res.status(status).json({ success: false, message, code });
}

function handleWalletError(res, error, context) {
    if (error instanceof WalletServiceError) {
        return sendError(res, error.statusCode, error.message, error.code);
    }

    console.error(`${context}:`, error);
    return res.status(500).json({
        success: false,
        message: 'Server Error',
        error: error.message
    });
}

function mapRoleToUserType(role) {
    if (role === 'tutor') return 'Tutor';
    return 'Student';
}

async function authorizeWalletAccess(req, targetUserId) {
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
        return { authorized: false, status: 400, message: 'Invalid userId', code: 'VALIDATION_ERROR' };
    }

    if (req.user._id.toString() === targetUserId.toString()) {
        return { authorized: true };
    }

    if (req.user.role === 'parent') {
        const studentProfile = await Student.findOne({ user: targetUserId });
        if (!studentProfile) {
            return { authorized: false, status: 403, message: 'Forbidden', code: 'FORBIDDEN' };
        }

        const isLinked = req.profile?.linkedStudents?.some(
            (id) => id.toString() === studentProfile._id.toString()
        );

        if (isLinked) {
            return { authorized: true };
        }
    }

    return { authorized: false, status: 403, message: 'Forbidden', code: 'FORBIDDEN' };
}

function formatTransactionForUI(transaction) {
    const plain = transaction.toObject ? transaction.toObject() : transaction;

    return {
        _id: plain._id,
        transactionId: plain.transactionId,
        type: plain.type,
        direction: plain.direction,
        title: plain.title,
        amount: plain.amount,
        displayAmount: formatTransactionAmount(plain.amount, plain.direction),
        currency: plain.currency,
        paymentMethod: plain.paymentMethod,
        paymentMethodLabel: formatPaymentMethodLabel(plain.paymentMethod),
        phoneNumber: plain.phoneNumber,
        recipientName: plain.recipientName,
        bookingId: plain.bookingId,
        status: plain.status,
        displayTimestamp: formatTransactionTimestamp(plain.createdAt),
        createdAt: plain.createdAt,
        updatedAt: plain.updatedAt
    };
}

// GET /api/wallet/balance/:userId
router.get('/balance/:userId', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;

        const auth = await authorizeWalletAccess(req, userId);
        if (!auth.authorized) {
            return sendError(res, auth.status, auth.message, auth.code);
        }

        const data = await walletService.getWalletDetails(userId);

        return res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        return handleWalletError(res, error, 'Get Balance Error');
    }
});

// GET /api/wallet/transactions/:userId
router.get('/transactions/:userId', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;

        const auth = await authorizeWalletAccess(req, userId);
        if (!auth.authorized) {
            return sendError(res, auth.status, auth.message, auth.code);
        }

        const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
        const page = hasPagination ? Math.max(parseInt(req.query.page, 10) || 1, 1) : 1;
        const limit = hasPagination
            ? Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100)
            : 10;
        const skip = (page - 1) * limit;

        const [transactions, totalCount] = await Promise.all([
            Transaction.find({ userId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Transaction.countDocuments({ userId })
        ]);

        const data = transactions.map(formatTransactionForUI);

        const response = {
            success: true,
            results: data.length,
            data
        };

        if (hasPagination) {
            response.pagination = {
                page,
                limit,
                totalCount,
                totalPages: Math.ceil(totalCount / limit)
            };
        }

        return res.status(200).json(response);
    } catch (error) {
        return handleWalletError(res, error, 'Get Transactions Error');
    }
});

// POST /api/wallet/deposit
router.post('/deposit', authMiddleware, async (req, res) => {
    try {
        const { amount, paymentMethod, phoneNumber } = req.body;

        if (amount === undefined || amount === null || isNaN(Number(amount)) || Number(amount) <= 0) {
            return sendError(res, 400, 'amount must be a number greater than 0', 'VALIDATION_ERROR');
        }

        if (!['jazzcash', 'easypaisa'].includes(paymentMethod)) {
            return sendError(res, 400, 'paymentMethod must be jazzcash or easypaisa', 'VALIDATION_ERROR');
        }

        if (!phoneNumber || !/^\d{11}$/.test(String(phoneNumber))) {
            return sendError(res, 400, 'phoneNumber must be an 11-digit string', 'VALIDATION_ERROR');
        }

        const userId = req.user._id;
        const userType = mapRoleToUserType(req.user.role);

        const result = await walletService.processSandboxDeposit(
            userId,
            userType,
            Number(amount),
            paymentMethod,
            String(phoneNumber)
        );

        return res.status(201).json({
            success: true,
            message: 'Deposit completed successfully',
            data: {
                wallet: {
                    userId: result.wallet.userId,
                    userType: result.wallet.userType,
                    totalBalance: result.wallet.totalBalance,
                    escrowBalance: result.wallet.escrowBalance,
                    currency: result.wallet.currency,
                    displayTotalBalance: result.displayTotalBalance,
                    displayEscrowBalance: result.displayEscrowBalance
                },
                transaction: formatTransactionForUI(result.transaction)
            }
        });
    } catch (error) {
        return handleWalletError(res, error, 'Deposit Error');
    }
});

module.exports = router;
