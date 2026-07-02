const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const { formatCurrency } = require('../utils/walletHelpers');

class WalletServiceError extends Error {
    constructor(message, code, statusCode = 400) {
        super(message);
        this.name = 'WalletServiceError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function normalizeUserType(userType) {
    if (userType === 'Student' || userType === 'Tutor') {
        return userType;
    }
    throw new WalletServiceError('Invalid userType. Must be Student or Tutor.', 'VALIDATION_ERROR', 400);
}

function normalizePaymentMethodLabel(paymentMethod) {
    if (paymentMethod === 'jazzcash') return 'JazzCash';
    if (paymentMethod === 'easypaisa') return 'EasyPaisa';
    return paymentMethod;
}

function mapRoleToWalletUserType(role) {
    if (role === 'student') return 'Student';
    if (role === 'tutor') return 'Tutor';
    return null;
}

async function createWalletOnSignup(userId, role, session = null) {
    const userType = mapRoleToWalletUserType(role);
    if (!userType) return null;

    const created = await Wallet.create(
        [{ userId, userType }],
        session ? { session } : undefined
    );
    return created[0];
}

async function getOrCreateWallet(userId, userType, session = null) {
    const normalizedType = normalizeUserType(userType);

    let query = Wallet.findOne({ userId });
    if (session) query = query.session(session);

    let wallet = await query;

    if (!wallet) {
        const created = await Wallet.create(
            [{ userId, userType: normalizedType }],
            session ? { session } : undefined
        );
        wallet = created[0];
    }

    return wallet;
}

async function createTransactionRecord(payload, session = null) {
    const created = await Transaction.create([payload], session ? { session } : undefined);
    return created[0];
}

async function findEscrowTransaction(bookingId, type, session = null) {
    let query = Transaction.findOne({ bookingId, type, status: 'completed' });
    if (session) query = query.session(session);
    return query;
}

/**
 * Sandbox deposit — JazzCash / EasyPaisa simulation.
 */
async function processSandboxDeposit(userId, userType, amount, paymentMethod, phoneNumber) {
    const numericAmount = Number(amount);

    if (!numericAmount || numericAmount < 1) {
        throw new WalletServiceError('Deposit amount must be at least 1.', 'VALIDATION_ERROR', 400);
    }

    if (!['jazzcash', 'easypaisa'].includes(paymentMethod)) {
        throw new WalletServiceError('paymentMethod must be jazzcash or easypaisa.', 'VALIDATION_ERROR', 400);
    }

    if (!phoneNumber || !/^\d{11}$/.test(String(phoneNumber))) {
        throw new WalletServiceError('phoneNumber must be an 11-digit number.', 'VALIDATION_ERROR', 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const wallet = await getOrCreateWallet(userId, userType, session);

        wallet.totalBalance += numericAmount;
        await wallet.save({ session });

        const transaction = await createTransactionRecord({
            walletId: wallet._id,
            userId,
            type: 'deposit',
            direction: 'credit',
            amount: numericAmount,
            currency: wallet.currency,
            title: `Deposit via ${normalizePaymentMethodLabel(paymentMethod)}`,
            paymentMethod,
            phoneNumber: String(phoneNumber),
            status: 'completed'
        }, session);

        await session.commitTransaction();

        return {
            wallet,
            transaction,
            displayTotalBalance: formatCurrency(wallet.totalBalance),
            displayEscrowBalance: formatCurrency(wallet.escrowBalance)
        };
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
}

/**
 * Escrow hold — triggered when tutor accepts a booking.
 */
async function holdEscrow(bookingId, studentId, amount, tutorName) {
    const numericAmount = Number(amount);

    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
        throw new WalletServiceError('Invalid bookingId.', 'VALIDATION_ERROR', 400);
    }

    if (!numericAmount || numericAmount < 1) {
        throw new WalletServiceError('Escrow amount must be at least 1.', 'VALIDATION_ERROR', 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const existingHold = await findEscrowTransaction(bookingId, 'escrow_hold', session);
        if (existingHold) {
            throw new WalletServiceError('Escrow already held for this booking.', 'ESCROW_ALREADY_HELD', 409);
        }

        const wallet = await Wallet.findOne({ userId: studentId }).session(session);

        if (!wallet) {
            throw new WalletServiceError('Student wallet not found.', 'NOT_FOUND', 404);
        }

        if (wallet.totalBalance < numericAmount) {
            throw new WalletServiceError('Insufficient balance to hold escrow.', 'INSUFFICIENT_BALANCE', 400);
        }

        wallet.totalBalance -= numericAmount;
        wallet.escrowBalance += numericAmount;
        await wallet.save({ session });

        const transaction = await createTransactionRecord({
            walletId: wallet._id,
            userId: studentId,
            type: 'escrow_hold',
            direction: 'debit',
            amount: numericAmount,
            currency: wallet.currency,
            title: `Payment to ${tutorName}`,
            recipientName: tutorName,
            bookingId,
            status: 'completed',
            escrowStatus: 'held'
        }, session);

        await session.commitTransaction();

        return { wallet, transaction };
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
}

/**
 * Escrow release — triggered when session is marked completed.
 */
async function releaseEscrow(bookingId, studentId, tutorId, amount) {
    const numericAmount = Number(amount);

    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
        throw new WalletServiceError('Invalid bookingId.', 'VALIDATION_ERROR', 400);
    }

    if (!numericAmount || numericAmount < 1) {
        throw new WalletServiceError('Release amount must be at least 1.', 'VALIDATION_ERROR', 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const existingRelease = await findEscrowTransaction(bookingId, 'escrow_release', session);
        if (existingRelease) {
            throw new WalletServiceError('Escrow already released for this booking.', 'ESCROW_ALREADY_RELEASED', 409);
        }

        const holdRecord = await findEscrowTransaction(bookingId, 'escrow_hold', session);
        if (!holdRecord) {
            throw new WalletServiceError('No escrow hold found for this booking.', 'NO_ESCROW_FOUND', 409);
        }

        const studentWallet = await Wallet.findOne({ userId: studentId }).session(session);
        if (!studentWallet) {
            throw new WalletServiceError('Student wallet not found.', 'NOT_FOUND', 404);
        }

        if (studentWallet.escrowBalance < numericAmount) {
            throw new WalletServiceError('Insufficient escrow balance to release.', 'INSUFFICIENT_ESCROW', 400);
        }

        studentWallet.escrowBalance -= numericAmount;
        await studentWallet.save({ session });

        const tutorWallet = await getOrCreateWallet(tutorId, 'Tutor', session);
        tutorWallet.totalBalance += numericAmount;
        await tutorWallet.save({ session });

        const studentTransaction = await createTransactionRecord({
            walletId: studentWallet._id,
            userId: studentId,
            type: 'escrow_release',
            direction: 'debit',
            amount: numericAmount,
            currency: studentWallet.currency,
            title: 'Session payment completed',
            paymentMethod: 'internal_transfer',
            bookingId,
            status: 'completed'
        }, session);

        const tutorTransaction = await createTransactionRecord({
            walletId: tutorWallet._id,
            userId: tutorId,
            type: 'escrow_release',
            direction: 'credit',
            amount: numericAmount,
            currency: tutorWallet.currency,
            title: 'Session payment received',
            paymentMethod: 'internal_transfer',
            bookingId,
            status: 'completed'
        }, session);

        holdRecord.escrowStatus = 'released';
        await holdRecord.save({ session });

        await session.commitTransaction();

        return {
            studentWallet,
            tutorWallet,
            studentTransaction,
            tutorTransaction
        };
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
}

/**
 * Escrow refund — triggered when a confirmed session is cancelled.
 */
async function refundEscrow(bookingId, studentId, amount) {
    const numericAmount = Number(amount);

    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
        throw new WalletServiceError('Invalid bookingId.', 'VALIDATION_ERROR', 400);
    }

    if (!numericAmount || numericAmount < 1) {
        throw new WalletServiceError('Refund amount must be at least 1.', 'VALIDATION_ERROR', 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const existingRefund = await findEscrowTransaction(bookingId, 'escrow_refund', session);
        if (existingRefund) {
            throw new WalletServiceError('Escrow already refunded for this booking.', 'ESCROW_ALREADY_REFUNDED', 409);
        }

        const holdRecord = await findEscrowTransaction(bookingId, 'escrow_hold', session);
        if (!holdRecord) {
            throw new WalletServiceError('No escrow hold found for this booking.', 'NO_ESCROW_FOUND', 409);
        }

        const wallet = await Wallet.findOne({ userId: studentId }).session(session);
        if (!wallet) {
            throw new WalletServiceError('Student wallet not found.', 'NOT_FOUND', 404);
        }

        if (wallet.escrowBalance < numericAmount) {
            throw new WalletServiceError('Insufficient escrow balance to refund.', 'INSUFFICIENT_ESCROW', 400);
        }

        wallet.escrowBalance -= numericAmount;
        wallet.totalBalance += numericAmount;
        await wallet.save({ session });

        const transaction = await createTransactionRecord({
            walletId: wallet._id,
            userId: studentId,
            type: 'escrow_refund',
            direction: 'credit',
            amount: numericAmount,
            currency: wallet.currency,
            title: 'Refund — session cancelled',
            paymentMethod: 'internal_transfer',
            bookingId,
            status: 'completed'
        }, session);

        holdRecord.escrowStatus = 'refunded';
        await holdRecord.save({ session });

        await session.commitTransaction();

        return { wallet, transaction };
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
}

/**
 * Wallet summary for Figma balance cards.
 */
async function getWalletDetails(userId) {
    const wallet = await Wallet.findOne({ userId });

    if (!wallet) {
        return {
            userId,
            totalBalance: 0,
            escrowBalance: 0,
            currency: 'PKR',
            displayTotalBalance: formatCurrency(0),
            displayEscrowBalance: formatCurrency(0),
            walletExists: false
        };
    }

    return {
        userId: wallet.userId,
        userType: wallet.userType,
        totalBalance: wallet.totalBalance,
        escrowBalance: wallet.escrowBalance,
        currency: wallet.currency,
        displayTotalBalance: formatCurrency(wallet.totalBalance),
        displayEscrowBalance: formatCurrency(wallet.escrowBalance),
        walletExists: true,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt
    };
}

module.exports = {
    WalletServiceError,
    processSandboxDeposit,
    holdEscrow,
    releaseEscrow,
    refundEscrow,
    getWalletDetails,
    getOrCreateWallet,
    createWalletOnSignup
};
