const mongoose = require('mongoose');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const ParentLinkCode = require('../models/ParentLinkCode');
const User = require('../models/User');

const CODE_TTL_MINUTES = 20;

class ParentLinkServiceError extends Error {
    constructor(message, code, statusCode = 400) {
        super(message);
        this.name = 'ParentLinkServiceError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

async function getStudentByUserId(studentUserId) {
    const user = await User.findById(studentUserId);
    if (!user) {
        throw new ParentLinkServiceError('User not found.', 'NOT_FOUND', 404);
    }

    if (user.role !== 'student') {
        throw new ParentLinkServiceError('Only students can generate link codes.', 'FORBIDDEN', 403);
    }

    let student = await Student.findOne({ user: studentUserId });
    if (!student) {
        throw new ParentLinkServiceError('Student profile not found.', 'NOT_FOUND', 404);
    }

    if (!student.publicId) {
        await student.save();
        student = await Student.findOne({ user: studentUserId });
    }

    return { user, student };
}

async function getParentByUserId(parentUserId) {
    const user = await User.findById(parentUserId);
    if (!user) {
        throw new ParentLinkServiceError('User not found.', 'NOT_FOUND', 404);
    }

    if (user.role !== 'parent') {
        throw new ParentLinkServiceError('Only parents can redeem link codes.', 'FORBIDDEN', 403);
    }

    const parent = await Parent.findOne({ user: parentUserId });
    if (!parent) {
        throw new ParentLinkServiceError('Parent profile not found.', 'NOT_FOUND', 404);
    }

    return { user, parent };
}

/**
 * Generate a new 6-character link code for a student (expires in 20 minutes).
 */
async function generateLinkCode(studentUserId) {
    const { student } = await getStudentByUserId(studentUserId);

    await ParentLinkCode.updateMany(
        { student: student._id, status: 'active' },
        { $set: { status: 'expired' } }
    );

    const linkCode = new ParentLinkCode({
        student: student._id,
        studentUserId,
        status: 'active'
    });

    await linkCode.save();

    return {
        code: linkCode.code,
        expiresAt: linkCode.expiresAt,
        expiresInMinutes: CODE_TTL_MINUTES,
        status: linkCode.status
    };
}

/**
 * Redeem a link code to permanently connect parent and student.
 */
async function redeemLinkCode(parentUserId, code) {
    if (!code || typeof code !== 'string' || code.trim().length !== 6) {
        throw new ParentLinkServiceError('A valid 6-character code is required.', 'VALIDATION_ERROR', 400);
    }

    const normalizedCode = code.trim().toUpperCase();
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { parent } = await getParentByUserId(parentUserId);

        const linkCode = await ParentLinkCode.findOne({ code: normalizedCode }).session(session);

        if (!linkCode) {
            throw new ParentLinkServiceError('Link code not found.', 'CODE_NOT_FOUND', 404);
        }

        if (linkCode.status === 'used') {
            throw new ParentLinkServiceError('Link code has already been used.', 'CODE_ALREADY_USED', 409);
        }

        if (linkCode.status === 'expired' || linkCode.expiresAt <= new Date()) {
            if (linkCode.status === 'active') {
                linkCode.status = 'expired';
                await linkCode.save({ session });
            }
            throw new ParentLinkServiceError('Link code has expired.', 'CODE_EXPIRED', 410);
        }

        if (linkCode.status !== 'active') {
            throw new ParentLinkServiceError('Link code is not active.', 'CODE_NOT_FOUND', 404);
        }

        const student = await Student.findById(linkCode.student).session(session);
        if (!student) {
            throw new ParentLinkServiceError('Student associated with this code was not found.', 'NOT_FOUND', 404);
        }

        const alreadyLinked = parent.linkedStudents.some(
            (id) => id.toString() === student._id.toString()
        );

        if (alreadyLinked) {
            throw new ParentLinkServiceError('This student is already linked to your account.', 'ALREADY_LINKED', 409);
        }

        parent.linkedStudents.push(student._id);
        await parent.save({ session });

        linkCode.status = 'used';
        linkCode.usedByParent = parent._id;
        linkCode.usedAt = new Date();
        await linkCode.save({ session });

        await session.commitTransaction();

        const studentUser = await User.findById(student.user).select('name email');

        return {
            message: 'Parent account linked successfully',
            student: {
                studentId: student._id,
                userId: student.user,
                name: studentUser?.name || '',
                email: studentUser?.email || '',
                publicId: student.publicId
            },
            linkedStudentsCount: parent.linkedStudents.length
        };
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
}

module.exports = {
    ParentLinkServiceError,
    generateLinkCode,
    redeemLinkCode
};
