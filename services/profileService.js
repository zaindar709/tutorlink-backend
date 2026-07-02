const mongoose = require('mongoose');
const User = require('../models/User');
const Student = require('../models/Student');
const UserPreferences = require('../models/UserPreferences');
const Parent = require('../models/Parent');
const ParentLinkCode = require('../models/ParentLinkCode');
const Booking = require('../models/Booking');
const {
    SETTINGS_MENU,
    formatDisplayGrade,
    formatDisplayStudentId
} = require('../utils/profileHelpers');

class ProfileServiceError extends Error {
    constructor(message, code, statusCode = 400) {
        super(message);
        this.name = 'ProfileServiceError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

async function getOrCreatePreferences(userId, session = null) {
    let query = UserPreferences.findOne({ userId });
    if (session) query = query.session(session);

    let preferences = await query;

    if (!preferences) {
        const created = await UserPreferences.create(
            [{ userId }],
            session ? { session } : undefined
        );
        preferences = created[0];
    }

    return preferences;
}

async function getStudentRecord(userId, session = null) {
    let userQuery = User.findById(userId);
    if (session) userQuery = userQuery.session(session);
    const user = await userQuery;

    if (!user) {
        throw new ProfileServiceError('User not found.', 'NOT_FOUND', 404);
    }

    if (user.role !== 'student') {
        throw new ProfileServiceError('Profile is only available for students.', 'FORBIDDEN', 403);
    }

    let studentQuery = Student.findOne({ user: userId });
    if (session) studentQuery = studentQuery.session(session);
    let student = await studentQuery;

    if (!student) {
        throw new ProfileServiceError('Student profile not found.', 'NOT_FOUND', 404);
    }

    if (!student.publicId) {
        await student.save({ session: session || undefined });
        studentQuery = Student.findOne({ user: userId });
        if (session) studentQuery = studentQuery.session(session);
        student = await studentQuery;
    }

    return { user, student };
}

async function getLinkedParents(studentId) {
    const parents = await Parent.find({ linkedStudents: studentId })
        .populate('user', 'name email phoneNumber avatarUrl');

    return parents.map((parent) => ({
        parentId: parent._id,
        userId: parent.user._id,
        name: parent.user.name,
        email: parent.user.email
    }));
}

async function getActiveLinkCode(studentId) {
    const now = new Date();
    return ParentLinkCode.findOne({
        student: studentId,
        status: 'active',
        expiresAt: { $gt: now }
    }).sort({ createdAt: -1 });
}

async function getSessionHistoryCount(userId) {
    return Booking.countDocuments({
        student: userId,
        status: { $in: ['completed', 'cancelled'] }
    });
}

/**
 * Full student profile for Figma Profile screen.
 */
async function getStudentProfile(userId) {
    const { user, student } = await getStudentRecord(userId);
    const preferences = await getOrCreatePreferences(userId);

    const [sessionHistoryCount, linkedParents, activeLinkCode] = await Promise.all([
        getSessionHistoryCount(userId),
        getLinkedParents(student._id),
        getActiveLinkCode(student._id)
    ]);

    const interestsCount = student.interests?.length || 0;
    const certificatesCount = student.certificates?.length || 0;

    const notificationsEnabled =
        preferences.notifications.sessionReminders ||
        preferences.notifications.bookingUpdates ||
        preferences.notifications.promotions;

    return {
        header: {
            name: user.name,
            email: user.email,
            phoneNumber: user.phoneNumber || '',
            avatarUrl: user.avatarUrl || '',
            displayGrade: formatDisplayGrade(student.grade),
            displayStudentId: formatDisplayStudentId(student.publicId),
            grade: student.grade,
            board: student.board
        },
        parentLinkCard: {
            title: 'Link Parent Account',
            subtitle: 'Share your progress with your parents',
            isLinked: linkedParents.length > 0,
            linkedParents,
            hasActiveCode: Boolean(activeLinkCode),
            activeCode: activeLinkCode ? activeLinkCode.code : null,
            activeCodeExpiresAt: activeLinkCode ? activeLinkCode.expiresAt : null
        },
        menuPreview: {
            interestsCount,
            certificatesCount,
            sessionHistoryCount
        },
        preferences: {
            notifications: preferences.notifications,
            privacy: preferences.privacy,
            app: preferences.app,
            notificationsEnabled
        },
        settingsMenu: SETTINGS_MENU.map((item) => ({
            ...item,
            count: item.id === 'interests' ? interestsCount
                : item.id === 'certificates' ? certificatesCount
                    : item.id === 'session-history' ? sessionHistoryCount
                        : undefined
        }))
    };
}

/**
 * Update User + Student profile fields atomically.
 */
async function updateStudentProfile(userId, updateData) {
    const allowedUserFields = ['name', 'phoneNumber', 'avatarUrl'];
    const allowedStudentFields = ['grade', 'board'];

    const userUpdates = {};
    const studentUpdates = {};

    for (const field of allowedUserFields) {
        if (updateData[field] !== undefined) {
            userUpdates[field] = updateData[field];
        }
    }

    for (const field of allowedStudentFields) {
        if (updateData[field] !== undefined) {
            studentUpdates[field] = updateData[field];
        }
    }

    if (!Object.keys(userUpdates).length && !Object.keys(studentUpdates).length) {
        throw new ProfileServiceError('No valid fields provided to update.', 'VALIDATION_ERROR', 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { user, student } = await getStudentRecord(userId, session);

        if (Object.keys(userUpdates).length) {
            Object.assign(user, userUpdates);
            await user.save({ session });
        }

        if (Object.keys(studentUpdates).length) {
            Object.assign(student, studentUpdates);
            await student.save({ session });
        }

        await session.commitTransaction();

        return getStudentProfile(userId);
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
}

/**
 * Replace student interests array.
 */
async function updateInterests(userId, interestsArray) {
    if (!Array.isArray(interestsArray)) {
        throw new ProfileServiceError('interests must be an array of strings.', 'VALIDATION_ERROR', 400);
    }

    if (!interestsArray.every((item) => typeof item === 'string' && item.trim().length > 0)) {
        throw new ProfileServiceError('Each interest must be a non-empty string.', 'VALIDATION_ERROR', 400);
    }

    const { student } = await getStudentRecord(userId);

    student.interests = interestsArray.map((item) => item.trim());
    await student.save();

    return {
        interests: student.interests,
        interestsCount: student.interests.length
    };
}

module.exports = {
    ProfileServiceError,
    getOrCreatePreferences,
    getStudentProfile,
    updateStudentProfile,
    updateInterests
};
