const mongoose = require('mongoose');
const Tutor = require('../models/Tutor');
const User = require('../models/User');
const Parent = require('../models/Parent');
const Student = require('../models/Student');
const Wallet = require('../models/Wallet');
const {
    AdminBillingServiceError,
    getEscrowTransactions,
    resolveEscrowDispute,
    formatEscrowTransaction
} = require('../services/adminBillingService');
const PENDING_STATUSES = ['under_review', 'interview_scheduled'];
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function sendError(res, status, message, code) {
    return res.status(status).json({ success: false, message, code });
}

function parsePagination(query) {
    const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
    const skip = (page - 1) * limit;

    return { page, limit, skip };
}

function formatTutorWithUser(tutor) {
    const user = tutor.user;

    return {
        _id: tutor._id,
        subjects: tutor.subjects,
        grades: tutor.grades,
        onboardingStep: tutor.onboardingStep,
        onboardingStatus: tutor.onboardingStatus,
        isVerified: tutor.isVerified,
        documentsSubmittedAt: tutor.documentsSubmittedAt,
        interviewScheduledAt: tutor.interviewScheduledAt,
        interviewLink: tutor.interviewLink,
        cnicFrontUrl: tutor.cnicFrontUrl,
        cnicBackUrl: tutor.cnicBackUrl,
        degreeCertificateUrl: tutor.degreeCertificateUrl,
        adminNotes: tutor.adminNotes,
        rejectionReason: tutor.rejectionReason,
        verifiedAt: tutor.verifiedAt,
        verifiedBy: tutor.verifiedBy,
        createdAt: tutor.createdAt,
        updatedAt: tutor.updatedAt,
        user: user
            ? {
                _id: user._id,
                name: user.name,
                email: user.email,
                phoneNumber: user.phoneNumber || ''
            }
            : null
    };
}

async function getPendingTutors(req, res) {
    try {
        const { page, limit, skip } = parsePagination(req.query);
        const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';

        let statusFilter = { $in: PENDING_STATUSES };
        if (status) {
            if (!PENDING_STATUSES.includes(status)) {
                return sendError(
                    res,
                    400,
                    `status must be one of: ${PENDING_STATUSES.join(', ')}`,
                    'VALIDATION_ERROR'
                );
            }
            statusFilter = status;
        }

        const query = { onboardingStatus: statusFilter };

        const [tutors, total] = await Promise.all([
            Tutor.find(query)
                .populate('user', 'name email phoneNumber')
                .sort({ documentsSubmittedAt: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Tutor.countDocuments(query)
        ]);

        return res.status(200).json({
            success: true,
            data: tutors.map(formatTutorWithUser),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit) || 1
            }
        });
    } catch (error) {
        console.error('Admin Get Pending Tutors Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
}

async function findTutorByProfileId(tutorProfileId) {
    if (!mongoose.Types.ObjectId.isValid(tutorProfileId)) {
        return { error: { status: 400, message: 'Invalid tutor profile id', code: 'VALIDATION_ERROR' } };
    }

    const tutor = await Tutor.findById(tutorProfileId).populate('user', 'name email phoneNumber');
    if (!tutor) {
        return { error: { status: 404, message: 'Tutor profile not found', code: 'NOT_FOUND' } };
    }

    return { tutor };
}

async function verifyTutor(req, res) {
    try {
        const { tutorProfileId } = req.params;
        const { adminNotes = '' } = req.body;

        const result = await findTutorByProfileId(tutorProfileId);
        if (result.error) {
            return sendError(res, result.error.status, result.error.message, result.error.code);
        }

        const tutor = await Tutor.findByIdAndUpdate(
            tutorProfileId,
            {
                $set: {
                    isVerified: true,
                    onboardingStatus: 'approved',
                    verifiedAt: new Date(),
                    verifiedBy: req.user._id,
                    adminNotes: typeof adminNotes === 'string' ? adminNotes.trim() : '',
                    rejectionReason: ''
                }
            },
            { new: true, runValidators: true }
        ).populate('user', 'name email phoneNumber');

        return res.status(200).json({
            success: true,
            message: 'Tutor verified successfully',
            data: formatTutorWithUser(tutor)
        });
    } catch (error) {
        console.error('Admin Verify Tutor Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
}

async function scheduleInterview(req, res) {
    try {
        const { tutorProfileId } = req.params;
        const { interviewScheduledAt, adminNotes = '' } = req.body;

        if (!interviewScheduledAt) {
            return sendError(res, 400, 'interviewScheduledAt is required', 'VALIDATION_ERROR');
        }

        const parsedDate = new Date(interviewScheduledAt);
        if (Number.isNaN(parsedDate.getTime())) {
            return sendError(res, 400, 'interviewScheduledAt must be a valid date', 'VALIDATION_ERROR');
        }

        const result = await findTutorByProfileId(tutorProfileId);
        if (result.error) {
            return sendError(res, result.error.status, result.error.message, result.error.code);
        }

        const tutor = await Tutor.findByIdAndUpdate(
            tutorProfileId,
            {
                $set: {
                    isVerified: false,
                    onboardingStatus: 'interview_scheduled',
                    interviewScheduledAt: parsedDate,
                    adminNotes: typeof adminNotes === 'string' ? adminNotes.trim() : ''
                }
            },
            { new: true, runValidators: true }
        ).populate('user', 'name email phoneNumber');

        return res.status(200).json({
            success: true,
            message: 'Interview scheduled successfully',
            data: formatTutorWithUser(tutor)
        });
    } catch (error) {
        console.error('Admin Schedule Interview Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
}

async function rejectTutor(req, res) {
    try {
        const { tutorProfileId } = req.params;
        const { rejectionReason } = req.body;

        if (!rejectionReason || typeof rejectionReason !== 'string' || !rejectionReason.trim()) {
            return sendError(res, 400, 'rejectionReason is required', 'VALIDATION_ERROR');
        }

        const result = await findTutorByProfileId(tutorProfileId);
        if (result.error) {
            return sendError(res, result.error.status, result.error.message, result.error.code);
        }

        const tutor = await Tutor.findByIdAndUpdate(
            tutorProfileId,
            {
                $set: {
                    isVerified: false,
                    onboardingStatus: 'rejected',
                    rejectionReason: rejectionReason.trim()
                }
            },
            { new: true, runValidators: true }
        ).populate('user', 'name email phoneNumber');

        return res.status(200).json({
            success: true,
            message: 'Tutor rejected successfully',
            data: formatTutorWithUser(tutor)
        });
    } catch (error) {
        console.error('Admin Reject Tutor Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
}

async function getDashboardStats(req, res) {
    try {
        const [totalTutors, verifiedTutors, totalStudents, escrowAggregate] = await Promise.all([
            Tutor.countDocuments(),
            Tutor.countDocuments({ onboardingStatus: 'approved' }),
            User.countDocuments({ role: 'student' }),
            Wallet.aggregate([
                {
                    $group: {
                        _id: null,
                        totalEscrowBalance: { $sum: '$escrowBalance' }
                    }
                }
            ])
        ]);

        const totalEscrowBalance = escrowAggregate[0]?.totalEscrowBalance || 0;

        return res.status(200).json({
            success: true,
            data: {
                totalTutors,
                verifiedTutors,
                totalStudents,
                totalEscrowBalance,
                currency: 'PKR'
            }
        });
    } catch (error) {
        console.error('Admin Dashboard Stats Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
}

async function getEscrowBilling(req, res) {
    try {
        const { page, limit, skip } = parsePagination(req.query);
        const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';

        const { data, total } = await getEscrowTransactions({ status, page, limit, skip });

        return res.status(200).json({
            success: true,
            data,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit) || 1
            }
        });
    } catch (error) {
        if (error instanceof AdminBillingServiceError) {
            return sendError(res, error.statusCode, error.message, error.code);
        }

        console.error('Admin Get Escrow Billing Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
}

async function resolveBillingDispute(req, res) {
    try {
        const { transactionId } = req.params;
        const { action, notes = '' } = req.body;

        if (!action || !['refund', 'release'].includes(action)) {
            return sendError(res, 400, "action must be 'refund' or 'release'", 'VALIDATION_ERROR');
        }

        if (!notes || typeof notes !== 'string' || !notes.trim()) {
            return sendError(res, 400, 'notes is required', 'VALIDATION_ERROR');
        }

        const transaction = await resolveEscrowDispute(transactionId, action, notes.trim());

        return res.status(200).json({
            success: true,
            message: `Escrow dispute resolved via ${action}`,
            data: formatEscrowTransaction(transaction)
        });
    } catch (error) {
        if (error instanceof AdminBillingServiceError) {
            return sendError(res, error.statusCode, error.message, error.code);
        }

        console.error('Admin Resolve Billing Dispute Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
}

function buildLinkId(parentProfileId, studentProfileId) {
    return `${parentProfileId}_${studentProfileId}`;
}

function parseLinkId(linkId) {
    if (!linkId || typeof linkId !== 'string' || !linkId.includes('_')) {
        return { valid: false, message: 'Invalid link id format', code: 'VALIDATION_ERROR' };
    }

    const separatorIndex = linkId.indexOf('_');
    const parentProfileId = linkId.slice(0, separatorIndex);
    const studentProfileId = linkId.slice(separatorIndex + 1);

    if (!mongoose.Types.ObjectId.isValid(parentProfileId) || !mongoose.Types.ObjectId.isValid(studentProfileId)) {
        return { valid: false, message: 'Invalid link id', code: 'VALIDATION_ERROR' };
    }

    return { valid: true, parentProfileId, studentProfileId };
}

async function getParentStudentLinks(req, res) {
    try {
        const { page, limit, skip } = parsePagination(req.query);

        const parents = await Parent.find({ linkedStudents: { $exists: true, $not: { $size: 0 } } })
            .populate('user', 'name email phoneNumber')
            .populate({
                path: 'linkedStudents',
                populate: { path: 'user', select: 'name email phoneNumber' }
            });

        const links = [];

        for (const parent of parents) {
            for (const student of parent.linkedStudents) {
                if (!student) continue;

                links.push({
                    linkId: buildLinkId(parent._id, student._id),
                    parent: {
                        profileId: parent._id,
                        userId: parent.user?._id || parent.user,
                        name: parent.user?.name || '',
                        email: parent.user?.email || '',
                        phoneNumber: parent.user?.phoneNumber || ''
                    },
                    student: {
                        profileId: student._id,
                        userId: student.user?._id || student.user,
                        name: student.user?.name || '',
                        email: student.user?.email || '',
                        phoneNumber: student.user?.phoneNumber || '',
                        publicId: student.publicId || ''
                    },
                    linkedAt: parent.updatedAt
                });
            }
        }

        links.sort((a, b) => new Date(b.linkedAt) - new Date(a.linkedAt));

        const total = links.length;
        const paginatedLinks = links.slice(skip, skip + limit);

        return res.status(200).json({
            success: true,
            data: paginatedLinks,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit) || 1
            }
        });
    } catch (error) {
        console.error('Admin Get Parent-Student Links Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
}

async function revokeParentStudentLink(req, res) {
    try {
        const parsed = parseLinkId(req.params.linkId);
        if (!parsed.valid) {
            return sendError(res, 400, parsed.message, parsed.code);
        }

        const { parentProfileId, studentProfileId } = parsed;

        const parent = await Parent.findById(parentProfileId);
        if (!parent) {
            return sendError(res, 404, 'Parent profile not found', 'NOT_FOUND');
        }

        const student = await Student.findById(studentProfileId);
        if (!student) {
            return sendError(res, 404, 'Student profile not found', 'NOT_FOUND');
        }

        const isLinked = parent.linkedStudents.some(
            (id) => id.toString() === studentProfileId.toString()
        );

        if (!isLinked) {
            return sendError(res, 404, 'Linkage not found', 'NOT_FOUND');
        }

        parent.linkedStudents = parent.linkedStudents.filter(
            (id) => id.toString() !== studentProfileId.toString()
        );
        await parent.save();

        return res.status(200).json({
            success: true,
            message: 'Parent-student linkage revoked successfully',
            data: {
                linkId: buildLinkId(parentProfileId, studentProfileId),
                revoked: true
            }
        });
    } catch (error) {
        console.error('Admin Revoke Parent-Student Link Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
}

module.exports = {
    getPendingTutors,
    verifyTutor,
    scheduleInterview,
    rejectTutor,
    getDashboardStats,
    getEscrowBilling,
    resolveBillingDispute,
    getParentStudentLinks,
    revokeParentStudentLink
};
