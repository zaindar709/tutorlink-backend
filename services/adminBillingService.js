const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Booking = require('../models/Booking');
const Wallet = require('../models/Wallet');

const ESCROW_STATUSES = ['held', 'released', 'refunded', 'disputed'];
const RESOLVABLE_STATUSES = ['held', 'disputed'];

class AdminBillingServiceError extends Error {
    constructor(message, code, statusCode = 400) {
        super(message);
        this.name = 'AdminBillingServiceError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

async function findEscrowHoldTransaction(transactionId) {
    let query;

    if (mongoose.Types.ObjectId.isValid(transactionId)) {
        query = Transaction.findOne({
            _id: transactionId,
            type: 'escrow_hold'
        });
    } else {
        query = Transaction.findOne({
            transactionId,
            type: 'escrow_hold'
        });
    }

    const transaction = await query
        .populate({
            path: 'bookingId',
            populate: [
                { path: 'student', select: 'name email phoneNumber' },
                { path: 'tutor', select: 'name email phoneNumber' }
            ]
        });

    if (!transaction) {
        throw new AdminBillingServiceError('Escrow transaction not found.', 'NOT_FOUND', 404);
    }

    return transaction;
}

function formatEscrowTransaction(transaction) {
    const booking = transaction.bookingId;

    return {
        _id: transaction._id,
        transactionId: transaction.transactionId,
        type: transaction.type,
        amount: transaction.amount,
        currency: transaction.currency,
        title: transaction.title,
        escrowStatus: transaction.escrowStatus,
        adminNotes: transaction.adminNotes,
        status: transaction.status,
        bookingId: booking?._id || transaction.bookingId,
        student: booking?.student
            ? {
                _id: booking.student._id,
                name: booking.student.name,
                email: booking.student.email,
                phoneNumber: booking.student.phoneNumber || ''
            }
            : null,
        tutor: booking?.tutor
            ? {
                _id: booking.tutor._id,
                name: booking.tutor.name,
                email: booking.tutor.email,
                phoneNumber: booking.tutor.phoneNumber || ''
            }
            : null,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt
    };
}

async function getEscrowTransactions({ status, page, limit, skip }) {
    const query = { type: 'escrow_hold' };

    if (status) {
        if (!ESCROW_STATUSES.includes(status)) {
            throw new AdminBillingServiceError(
                `status must be one of: ${ESCROW_STATUSES.join(', ')}`,
                'VALIDATION_ERROR',
                400
            );
        }
        query.escrowStatus = status;
    }

    const [transactions, total] = await Promise.all([
        Transaction.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate({
                path: 'bookingId',
                populate: [
                    { path: 'student', select: 'name email phoneNumber' },
                    { path: 'tutor', select: 'name email phoneNumber' }
                ]
            }),
        Transaction.countDocuments(query)
    ]);

    return {
        data: transactions.map(formatEscrowTransaction),
        total
    };
}

async function createTransactionRecord(payload, session) {
    const created = await Transaction.create([payload], { session });
    return created[0];
}

async function resolveEscrowDispute(transactionId, action, notes) {
    const holdTransaction = await findEscrowHoldTransaction(transactionId);

    if (!RESOLVABLE_STATUSES.includes(holdTransaction.escrowStatus)) {
        throw new AdminBillingServiceError(
            'Only held or disputed escrow transactions can be resolved.',
            'INVALID_ESCROW_STATE',
            409
        );
    }

    const booking = await Booking.findById(holdTransaction.bookingId);
    if (!booking) {
        throw new AdminBillingServiceError('Associated booking not found.', 'NOT_FOUND', 404);
    }

    const numericAmount = holdTransaction.amount;
    const studentId = booking.student;
    const tutorId = booking.tutor;
    const bookingId = booking._id;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const lockedHold = await Transaction.findOne({
            _id: holdTransaction._id,
            type: 'escrow_hold'
        }).session(session);

        if (!lockedHold || !RESOLVABLE_STATUSES.includes(lockedHold.escrowStatus)) {
            throw new AdminBillingServiceError(
                'Escrow transaction is no longer in a resolvable state.',
                'INVALID_ESCROW_STATE',
                409
            );
        }

        if (action === 'refund') {
            const existingRefund = await Transaction.findOne({
                bookingId,
                type: 'escrow_refund',
                status: 'completed'
            }).session(session);

            if (existingRefund) {
                throw new AdminBillingServiceError('Escrow already refunded for this booking.', 'ESCROW_ALREADY_REFUNDED', 409);
            }

            const studentWallet = await Wallet.findOne({ userId: studentId }).session(session);
            if (!studentWallet) {
                throw new AdminBillingServiceError('Student wallet not found.', 'NOT_FOUND', 404);
            }

            if (studentWallet.escrowBalance < numericAmount) {
                throw new AdminBillingServiceError('Insufficient escrow balance to refund.', 'INSUFFICIENT_ESCROW', 400);
            }

            studentWallet.escrowBalance -= numericAmount;
            studentWallet.totalBalance += numericAmount;
            await studentWallet.save({ session });

            await createTransactionRecord({
                walletId: studentWallet._id,
                userId: studentId,
                type: 'escrow_refund',
                direction: 'credit',
                amount: numericAmount,
                currency: studentWallet.currency,
                title: 'Admin dispute refund',
                paymentMethod: 'internal_transfer',
                bookingId,
                status: 'completed'
            }, session);

            lockedHold.escrowStatus = 'refunded';
        } else if (action === 'release') {
            const existingRelease = await Transaction.findOne({
                bookingId,
                type: 'escrow_release',
                status: 'completed'
            }).session(session);

            if (existingRelease) {
                throw new AdminBillingServiceError('Escrow already released for this booking.', 'ESCROW_ALREADY_RELEASED', 409);
            }

            const studentWallet = await Wallet.findOne({ userId: studentId }).session(session);
            if (!studentWallet) {
                throw new AdminBillingServiceError('Student wallet not found.', 'NOT_FOUND', 404);
            }

            if (studentWallet.escrowBalance < numericAmount) {
                throw new AdminBillingServiceError('Insufficient escrow balance to release.', 'INSUFFICIENT_ESCROW', 400);
            }

            studentWallet.escrowBalance -= numericAmount;
            await studentWallet.save({ session });

            let tutorWallet = await Wallet.findOne({ userId: tutorId }).session(session);
            if (!tutorWallet) {
                const created = await Wallet.create(
                    [{ userId: tutorId, userType: 'Tutor' }],
                    { session }
                );
                tutorWallet = created[0];
            }

            tutorWallet.totalBalance += numericAmount;
            await tutorWallet.save({ session });

            await createTransactionRecord({
                walletId: studentWallet._id,
                userId: studentId,
                type: 'escrow_release',
                direction: 'debit',
                amount: numericAmount,
                currency: studentWallet.currency,
                title: 'Admin dispute release',
                paymentMethod: 'internal_transfer',
                bookingId,
                status: 'completed'
            }, session);

            await createTransactionRecord({
                walletId: tutorWallet._id,
                userId: tutorId,
                type: 'escrow_release',
                direction: 'credit',
                amount: numericAmount,
                currency: tutorWallet.currency,
                title: 'Admin dispute payment received',
                paymentMethod: 'internal_transfer',
                bookingId,
                status: 'completed'
            }, session);

            lockedHold.escrowStatus = 'released';
        } else {
            throw new AdminBillingServiceError("action must be 'refund' or 'release'.", 'VALIDATION_ERROR', 400);
        }

        lockedHold.adminNotes = notes;
        await lockedHold.save({ session });

        await session.commitTransaction();

        return findEscrowHoldTransaction(lockedHold.transactionId);
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
}

module.exports = {
    AdminBillingServiceError,
    ESCROW_STATUSES,
    getEscrowTransactions,
    resolveEscrowDispute,
    formatEscrowTransaction
};
