const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Booking = require('../models/Booking');
const User = require('../models/User');
const Tutor = require('../models/Tutor');
const Student = require('../models/Student');
const authMiddleware = require('../middleware/authMiddleware');
const walletService = require('../services/walletService');
const { WalletServiceError } = require('../services/walletService');
const {
    parseTimeToMinutes,
    parseBookingDate,
    getDayRange,
    getSessionDateTime,
    intervalsOverlap,
    sortByStartTime,
    calculateSessionAmount
} = require('../utils/bookingHelpers');

const ACTIVE_STATUSES = ['pending', 'accepted'];

async function findTutorConflict(tutorId, dayStart, dayEnd, startMinutes, endMinutes, excludeBookingId = null) {
    const query = {
        tutor: tutorId,
        date: { $gte: dayStart, $lt: dayEnd },
        status: { $in: ACTIVE_STATUSES }
    };

    if (excludeBookingId) {
        query._id = { $ne: excludeBookingId };
    }

    const existingBookings = await Booking.find(query);

    for (const booking of existingBookings) {
        const existingStart = parseTimeToMinutes(booking.startTime);
        const existingEnd = parseTimeToMinutes(booking.endTime);
        if (existingStart === null || existingEnd === null) continue;

        if (intervalsOverlap(startMinutes, endMinutes, existingStart, existingEnd)) {
            return booking;
        }
    }

    return null;
}

async function resolveStudentUserId(req, studentIdFromBody) {
    if (req.user.role === 'student') {
        return req.user._id;
    }

    if (req.user.role === 'parent') {
        if (!studentIdFromBody) {
            return { error: { status: 400, message: 'studentId is required when booking as a parent', code: 'VALIDATION_ERROR' } };
        }

        if (!mongoose.Types.ObjectId.isValid(studentIdFromBody)) {
            return { error: { status: 400, message: 'Invalid studentId', code: 'VALIDATION_ERROR' } };
        }

        const studentProfile = await Student.findOne({ user: studentIdFromBody });
        if (!studentProfile) {
            return { error: { status: 404, message: 'Student profile not found', code: 'NOT_FOUND' } };
        }

        const isLinked = req.profile?.linkedStudents?.some(
            (id) => id.toString() === studentProfile._id.toString()
        );

        if (!isLinked) {
            return { error: { status: 403, message: 'Student is not linked to your account', code: 'NOT_LINKED_STUDENT' } };
        }

        return studentProfile.user;
    }

    return { error: { status: 403, message: 'Only students and parents can create bookings', code: 'FORBIDDEN' } };
}

async function getParticipantFilter(req) {
    if (req.user.role === 'student') {
        return { student: req.user._id };
    }

    if (req.user.role === 'tutor') {
        return { tutor: req.user._id };
    }

    if (req.user.role === 'parent') {
        const linkedStudents = await Student.find({
            _id: { $in: req.profile?.linkedStudents || [] }
        }).select('user');

        const studentUserIds = linkedStudents.map((s) => s.user);
        return { student: { $in: studentUserIds } };
    }

    return null;
}


async function isParentParticipant(req, booking) {
    if (req.user.role !== 'parent') return false;

    const studentProfile = await Student.findOne({ user: booking.student });
    if (!studentProfile) return false;

    return req.profile?.linkedStudents?.some(
        (id) => id.toString() === studentProfile._id.toString()
    );
}

function filterByTab(bookings, tab) {
    const now = new Date();

    return bookings.filter((booking) => {
        const sessionEnd = getSessionDateTime(booking.date, booking.endTime);

        if (tab === 'pending') {
            return booking.status === 'pending';
        }

        if (tab === 'active') {
            return booking.status === 'accepted' && sessionEnd && sessionEnd > now;
        }

        if (tab === 'past') {
            if (booking.status === 'completed' || booking.status === 'cancelled') {
                return true;
            }
            if (booking.status === 'accepted' && sessionEnd && sessionEnd <= now) {
                return true;
            }
            return false;
        }

        return false;
    });
}

function markNextSession(bookings) {
    const now = new Date();
    let nextMarked = false;

    return bookings.map((booking) => {
        const plain = booking.toObject ? booking.toObject() : { ...booking };
        const sessionStart = getSessionDateTime(plain.date, plain.startTime);

        plain.isNextSession = false;

        if (!nextMarked && plain.status === 'accepted' && sessionStart && sessionStart > now) {
            plain.isNextSession = true;
            nextMarked = true;
        }

        return plain;
    });
}

function sendError(res, status, message, code) {
    return res.status(status).json({ success: false, message, code });
}

function handleRouteError(res, error, context) {
    if (error instanceof WalletServiceError) {
        return sendError(res, error.statusCode, error.message, error.code);
    }

    console.error(`${context}:`, error);
    return res.status(500).json({ success: false, message: 'Server Error', error: error.message });
}

function resolveSessionAmount(booking, res) {
    const sessionAmount = calculateSessionAmount(
        booking.hourlyRateAtBooking,
        booking.startTime,
        booking.endTime
    );

    if (!sessionAmount) {
        sendError(res, 400, 'Unable to calculate session amount from booking times', 'VALIDATION_ERROR');
        return null;
    }

    return sessionAmount;
}

// POST /api/bookings — Create booking request
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { tutor: tutorId, subject, date, startTime, endTime, studentId } = req.body;

        if (!tutorId || !subject || !date || !startTime || !endTime) {
            return sendError(res, 400, 'tutor, subject, date, startTime, and endTime are required', 'VALIDATION_ERROR');
        }

        if (!mongoose.Types.ObjectId.isValid(tutorId)) {
            return sendError(res, 400, 'Invalid tutor id', 'VALIDATION_ERROR');
        }

        const studentResult = await resolveStudentUserId(req, studentId);
        if (studentResult?.error) {
            return sendError(res, studentResult.error.status, studentResult.error.message, studentResult.error.code);
        }
        const studentUserId = studentResult;

        if (studentUserId.toString() === tutorId.toString()) {
            return sendError(res, 400, 'Cannot book yourself', 'SELF_BOOKING');
        }

        const startMinutes = parseTimeToMinutes(startTime);
        const endMinutes = parseTimeToMinutes(endTime);

        if (startMinutes === null || endMinutes === null) {
            return sendError(res, 400, 'Invalid startTime or endTime format. Use "2:00 PM" or "14:00"', 'INVALID_TIME_RANGE');
        }

        if (startMinutes >= endMinutes) {
            return sendError(res, 400, 'startTime must be before endTime', 'INVALID_TIME_RANGE');
        }

        const bookingDate = parseBookingDate(date);
        const { dayStart, dayEnd } = getDayRange(
            typeof date === 'string' ? date : bookingDate.toISOString().slice(0, 10)
        );

        const todayStart = parseBookingDate(new Date().toISOString().slice(0, 10));
        if (dayStart < todayStart) {
            return sendError(res, 400, 'Cannot book past dates', 'PAST_DATE');
        }

        const tutorUser = await User.findById(tutorId);
        if (!tutorUser || tutorUser.role !== 'tutor') {
            return sendError(res, 404, 'Tutor not found', 'NOT_FOUND');
        }

        const tutorProfile = await Tutor.findOne({ user: tutorId });
        if (!tutorProfile) {
            return sendError(res, 404, 'Tutor profile not found', 'NOT_FOUND');
        }

        if (!tutorProfile.hourlyRate || tutorProfile.hourlyRate <= 0) {
            return sendError(res, 400, 'Tutor has no hourly rate configured', 'TUTOR_UNAVAILABLE');
        }

        if (!tutorProfile.availability) {
            return sendError(res, 400, 'Tutor is not accepting bookings', 'TUTOR_UNAVAILABLE');
        }

        const conflict = await findTutorConflict(tutorId, dayStart, dayEnd, startMinutes, endMinutes);
        if (conflict) {
            return sendError(res, 409, 'Tutor is not available for this time slot', 'SLOT_CONFLICT');
        }

        const booking = await Booking.create({
            student: studentUserId,
            tutor: tutorId,
            subject,
            date: bookingDate,
            startTime,
            endTime,
            status: 'pending',
            hourlyRateAtBooking: tutorProfile.hourlyRate,
            meetingLink: ''
        });

        const populatedBooking = await Booking.findById(booking._id)
            .populate('student', 'name email')
            .populate('tutor', 'name email');

        return res.status(201).json({
            success: true,
            message: 'Booking request created successfully',
            data: populatedBooking
        });
    } catch (error) {
        console.error('Create Booking Error:', error);
        return res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
});

// GET /api/bookings?date=YYYY-MM-DD&tab=active|pending|past
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { date, tab } = req.query;

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return sendError(res, 400, 'date query parameter is required in YYYY-MM-DD format', 'VALIDATION_ERROR');
        }

        const validTabs = ['active', 'pending', 'past'];
        if (!tab || !validTabs.includes(tab)) {
            return sendError(res, 400, 'tab query parameter is required (active, pending, or past)', 'VALIDATION_ERROR');
        }

        const participantFilter = await getParticipantFilter(req);
        if (!participantFilter) {
            return sendError(res, 403, 'Forbidden', 'FORBIDDEN');
        }

        const { dayStart, dayEnd } = getDayRange(date);

        const bookings = await Booking.find({
            ...participantFilter,
            date: { $gte: dayStart, $lt: dayEnd }
        })
            .populate('student', 'name email')
            .populate('tutor', 'name email');

        const filtered = filterByTab(bookings, tab);
        const sorted = sortByStartTime(filtered);
        const data = tab === 'active' ? markNextSession(sorted) : sorted.map((b) => ({
            ...(b.toObject ? b.toObject() : b),
            isNextSession: false
        }));

        return res.status(200).json({
            success: true,
            results: data.length,
            data
        });
    } catch (error) {
        console.error('List Bookings Error:', error);
        return res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
});

// PATCH /api/bookings/:id/confirm — Tutor accepts booking
router.patch('/:id/confirm', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'tutor') {
            return sendError(res, 403, 'Only tutors can confirm bookings', 'FORBIDDEN');
        }

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return sendError(res, 400, 'Invalid booking id', 'VALIDATION_ERROR');
        }

        const booking = await Booking.findById(req.params.id);
        if (!booking) {
            return sendError(res, 404, 'Booking not found', 'NOT_FOUND');
        }

        if (booking.tutor.toString() !== req.user._id.toString()) {
            return sendError(res, 403, 'Only the assigned tutor can confirm this booking', 'FORBIDDEN');
        }

        if (booking.status !== 'pending') {
            return sendError(res, 409, 'Only pending bookings can be confirmed', 'INVALID_TRANSITION');
        }

        const sessionEnd = getSessionDateTime(booking.date, booking.endTime);
        if (sessionEnd && sessionEnd < new Date()) {
            return sendError(res, 409, 'Cannot confirm a session that has already ended', 'SESSION_EXPIRED');
        }

        const startMinutes = parseTimeToMinutes(booking.startTime);
        const endMinutes = parseTimeToMinutes(booking.endTime);
        const dateString = booking.date.toISOString().slice(0, 10);
        const { dayStart, dayEnd } = getDayRange(dateString);

        const conflict = await findTutorConflict(
            booking.tutor,
            dayStart,
            dayEnd,
            startMinutes,
            endMinutes,
            booking._id
        );

        if (conflict) {
            return sendError(res, 409, 'Time slot no longer available', 'SLOT_CONFLICT');
        }

        const sessionAmount = resolveSessionAmount(booking, res);
        if (!sessionAmount) return;

        const tutorName = req.user.name;

        await walletService.holdEscrow(
            booking._id,
            booking.student,
            sessionAmount,
            tutorName
        );

        const { meetingLink = '' } = req.body;

        try {
            booking.status = 'accepted';
            booking.meetingLink = meetingLink;
            await booking.save();
        } catch (saveError) {
            try {
                await walletService.refundEscrow(booking._id, booking.student, sessionAmount);
            } catch (rollbackError) {
                console.error('Escrow rollback failed after confirm save error:', rollbackError);
            }
            throw saveError;
        }

        const populatedBooking = await Booking.findById(booking._id)
            .populate('student', 'name email')
            .populate('tutor', 'name email');

        return res.status(200).json({
            success: true,
            message: 'Booking confirmed successfully',
            data: populatedBooking,
            sessionAmount
        });
    } catch (error) {
        return handleRouteError(res, error, 'Confirm Booking Error');
    }
});

// PATCH /api/bookings/:id/cancel — Cancel booking
router.patch('/:id/cancel', authMiddleware, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return sendError(res, 400, 'Invalid booking id', 'VALIDATION_ERROR');
        }

        const booking = await Booking.findById(req.params.id);
        if (!booking) {
            return sendError(res, 404, 'Booking not found', 'NOT_FOUND');
        }

        if (booking.status === 'completed' || booking.status === 'cancelled') {
            return sendError(res, 409, 'Booking cannot be cancelled in its current state', 'INVALID_TRANSITION');
        }

        let canCancel = false;

        if (req.user.role === 'student' && booking.student.toString() === req.user._id.toString()) {
            canCancel = true;
        } else if (req.user.role === 'tutor' && booking.tutor.toString() === req.user._id.toString()) {
            canCancel = true;
        } else if (req.user.role === 'parent') {
            canCancel = await isParentParticipant(req, booking);
        }

        if (!canCancel) {
            return sendError(res, 403, 'You do not have permission to cancel this booking', 'FORBIDDEN');
        }

        const wasAccepted = booking.status === 'accepted';
        let sessionAmount = null;

        if (wasAccepted) {
            sessionAmount = resolveSessionAmount(booking, res);
            if (!sessionAmount) return;

            await walletService.refundEscrow(
                booking._id,
                booking.student,
                sessionAmount
            );
        }

        booking.status = 'cancelled';
        await booking.save();

        const populatedBooking = await Booking.findById(booking._id)
            .populate('student', 'name email')
            .populate('tutor', 'name email');

        return res.status(200).json({
            success: true,
            message: 'Booking cancelled successfully',
            data: populatedBooking,
            ...(sessionAmount && { sessionAmount, escrowRefunded: true })
        });
    } catch (error) {
        return handleRouteError(res, error, 'Cancel Booking Error');
    }
});

// PATCH /api/bookings/:id/complete — Tutor marks session completed
router.patch('/:id/complete', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'tutor') {
            return sendError(res, 403, 'Only tutors can complete bookings', 'FORBIDDEN');
        }

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return sendError(res, 400, 'Invalid booking id', 'VALIDATION_ERROR');
        }

        const booking = await Booking.findById(req.params.id);
        if (!booking) {
            return sendError(res, 404, 'Booking not found', 'NOT_FOUND');
        }

        if (booking.tutor.toString() !== req.user._id.toString()) {
            return sendError(res, 403, 'Only the assigned tutor can complete this booking', 'FORBIDDEN');
        }

        if (booking.status !== 'accepted') {
            return sendError(res, 409, 'Only accepted bookings can be completed', 'INVALID_TRANSITION');
        }

        const sessionStart = getSessionDateTime(booking.date, booking.startTime);
        if (sessionStart && sessionStart > new Date()) {
            return sendError(res, 409, 'Cannot complete a session that has not started yet', 'SESSION_NOT_STARTED');
        }

        const sessionAmount = resolveSessionAmount(booking, res);
        if (!sessionAmount) return;

        await walletService.releaseEscrow(
            booking._id,
            booking.student,
            booking.tutor,
            sessionAmount
        );

        booking.status = 'completed';
        await booking.save();

        const populatedBooking = await Booking.findById(booking._id)
            .populate('student', 'name email')
            .populate('tutor', 'name email');

        return res.status(200).json({
            success: true,
            message: 'Booking completed successfully',
            data: populatedBooking,
            sessionAmount
        });
    } catch (error) {
        return handleRouteError(res, error, 'Complete Booking Error');
    }
});

module.exports = router;
