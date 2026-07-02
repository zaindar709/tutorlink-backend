const Booking = require('../models/Booking');
const User = require('../models/User');
const {
    getDayRange,
    getSessionDateTime,
    sortByStartTime
} = require('../utils/bookingHelpers');

class HomeServiceError extends Error {
    constructor(message, code, statusCode = 400) {
        super(message);
        this.name = 'HomeServiceError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function getTodayDateString() {
    return new Date().toISOString().slice(0, 10);
}

function formatLesson(booking) {
    const tutor = booking.tutor;
    const sessionEnd = getSessionDateTime(booking.date, booking.endTime);
    const hasLink = Boolean(booking.meetingLink && booking.meetingLink.trim());
    const sessionNotEnded = sessionEnd ? sessionEnd > new Date() : true;

    return {
        _id: booking._id,
        subject: booking.subject,
        startTime: booking.startTime,
        endTime: booking.endTime,
        date: booking.date,
        status: booking.status,
        tutor: {
            _id: tutor._id,
            name: tutor.name,
            avatarUrl: tutor.avatarUrl || ''
        },
        meetingLink: booking.meetingLink || '',
        canJoinRoom: hasLink && sessionNotEnded
    };
}

function getQuickAccessStub() {
    return {
        assignments: { count: 0, label: 'new' },
        quizzes: { count: 0, label: 'pending' },
        tests: { count: 0, label: 'upcoming' }
    };
}

function getNotificationsStub() {
    return {
        unreadCount: 0,
        hasUnread: false
    };
}

/**
 * Aggregated student home dashboard (Phase 1 MVP).
 * Uses Booking + User only; other sections are honest placeholders.
 */
async function getStudentDashboard(userId) {
    const user = await User.findById(userId).select('role name');

    if (!user) {
        throw new HomeServiceError('User not found.', 'NOT_FOUND', 404);
    }

    if (user.role !== 'student') {
        throw new HomeServiceError('Dashboard is only available for students.', 'FORBIDDEN', 403);
    }

    const todayString = getTodayDateString();
    const { dayStart, dayEnd } = getDayRange(todayString);

    const bookings = await Booking.find({
        student: userId,
        status: 'accepted',
        date: { $gte: dayStart, $lt: dayEnd }
    }).populate('tutor', 'name avatarUrl email');

    const sorted = sortByStartTime(bookings);
    const currentLessons = sorted.map(formatLesson);

    return {
        todaySchedule: {
            title: "Today's Schedule",
            sectionTitle: 'Current Lessons',
            date: todayString,
            results: currentLessons.length,
            currentLessons
        },
        quickAccess: getQuickAccessStub(),
        aiSummaries: [],
        notifications: getNotificationsStub()
    };
}

module.exports = {
    HomeServiceError,
    getStudentDashboard
};
