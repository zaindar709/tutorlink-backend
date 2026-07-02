const express = require('express');
const multer = require('multer');
const router = express.Router();

const Tutor = require('../models/Tutor');
const authMiddleware = require('../middleware/authMiddleware');
const {
    tutorDocumentUpload,
    buildPublicDocumentPath,
    deleteLocalDocument,
    cleanupUploadedFiles
} = require('../utils/tutorDocumentUpload');

const ALLOWED_GRADES = ['Grade 9', 'Grade 10', 'O-Levels', 'A-Levels'];

function sendError(res, status, message, code) {
    return res.status(status).json({ success: false, message, code });
}

function requireTutor(req, res) {
    if (req.user.role !== 'tutor') {
        sendError(res, 403, 'Only tutors can access this resource', 'FORBIDDEN');
        return false;
    }

    if (!req.profile) {
        sendError(res, 404, 'Tutor profile not found', 'NOT_FOUND');
        return false;
    }

    return true;
}

function formatOnboardingProfile(tutor) {
    return {
        _id: tutor._id,
        user: tutor.user,
        subjects: tutor.subjects,
        grades: tutor.grades,
        onboardingStep: tutor.onboardingStep,
        onboardingStatus: tutor.onboardingStatus,
        isVerified: tutor.isVerified,
        createdAt: tutor.createdAt,
        updatedAt: tutor.updatedAt
    };
}

function formatDocumentUploadResponse(tutor) {
    return {
        onboardingStep: tutor.onboardingStep,
        onboardingStatus: tutor.onboardingStatus,
        documentsSubmittedAt: tutor.documentsSubmittedAt,
        cnicFrontUrl: tutor.cnicFrontUrl,
        cnicBackUrl: tutor.cnicBackUrl,
        degreeCertificateUrl: tutor.degreeCertificateUrl
    };
}

function formatInterviewResponse(tutor) {
    return {
        onboardingStep: tutor.onboardingStep,
        onboardingStatus: tutor.onboardingStatus,
        interviewScheduledAt: tutor.interviewScheduledAt,
        isVerified: tutor.isVerified
    };
}

function parseInterviewDate(interviewDate) {
    if (interviewDate === undefined || interviewDate === null || interviewDate === '') {
        return { valid: false, message: 'interviewDate is required', code: 'VALIDATION_ERROR' };
    }

    const parsedDate = new Date(interviewDate);
    if (Number.isNaN(parsedDate.getTime())) {
        return { valid: false, message: 'interviewDate must be a valid date', code: 'VALIDATION_ERROR' };
    }

    if (parsedDate <= new Date()) {
        return { valid: false, message: 'interviewDate must be in the future', code: 'VALIDATION_ERROR' };
    }

    return { valid: true, interviewDate: parsedDate };
}

function handleMulterError(err, req, res, next) {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return sendError(res, 400, 'Each file must be 5MB or smaller', 'VALIDATION_ERROR');
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return sendError(res, 400, 'Only cnicFront, cnicBack, and degree files are allowed', 'VALIDATION_ERROR');
        }
        return sendError(res, 400, err.message, 'VALIDATION_ERROR');
    }

    if (err) {
        return sendError(res, 400, err.message, 'VALIDATION_ERROR');
    }

    return next();
}

function validateStep1Payload({ subject, grades }) {
    if (typeof subject !== 'string' || !subject.trim()) {
        return { valid: false, message: 'subject is required and must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    if (!Array.isArray(grades) || grades.length === 0) {
        return { valid: false, message: 'grades is required and must be a non-empty array', code: 'VALIDATION_ERROR' };
    }

    if (grades.length > 2) {
        return { valid: false, message: 'grades may contain at most 2 items', code: 'VALIDATION_ERROR' };
    }

    const normalizedSubject = subject.trim();
    const normalizedGrades = grades.map((grade) => (typeof grade === 'string' ? grade.trim() : ''));

    if (normalizedGrades.some((grade) => !grade)) {
        return { valid: false, message: 'each grade must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    const uniqueGrades = [...new Set(normalizedGrades)];
    if (uniqueGrades.length !== normalizedGrades.length) {
        return { valid: false, message: 'grades must not contain duplicates', code: 'VALIDATION_ERROR' };
    }

    const invalidGrade = normalizedGrades.find((grade) => !ALLOWED_GRADES.includes(grade));
    if (invalidGrade) {
        return {
            valid: false,
            message: `Invalid grade "${invalidGrade}". Allowed values: ${ALLOWED_GRADES.join(', ')}`,
            code: 'VALIDATION_ERROR'
        };
    }

    return {
        valid: true,
        subject: normalizedSubject,
        grades: normalizedGrades
    };
}

// GET /api/tutor/onboarding/status
router.get('/status', authMiddleware, async (req, res) => {
    try {
        if (!requireTutor(req, res)) return;

        const tutor = await Tutor.findOne({ user: req.user._id }).select(
            'subjects grades onboardingStep onboardingStatus isVerified'
        );

        if (!tutor) {
            return sendError(res, 404, 'Tutor profile not found', 'NOT_FOUND');
        }

        return res.status(200).json({
            success: true,
            data: {
                onboardingStep: tutor.onboardingStep,
                onboardingStatus: tutor.onboardingStatus,
                subjects: tutor.subjects,
                grades: tutor.grades,
                isVerified: tutor.isVerified
            }
        });
    } catch (error) {
        console.error('Tutor Onboarding Status Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
});

// PATCH /api/tutor/onboarding/step-1
router.patch('/step-1', authMiddleware, async (req, res) => {
    try {
        if (!requireTutor(req, res)) return;

        const validation = validateStep1Payload(req.body);
        if (!validation.valid) {
            return sendError(res, 400, validation.message, validation.code);
        }

        const tutor = await Tutor.findOneAndUpdate(
            { user: req.user._id },
            {
                $set: {
                    subjects: [validation.subject],
                    grades: validation.grades,
                    onboardingStep: 2,
                    onboardingStatus: 'basic_info'
                }
            },
            { new: true, runValidators: true }
        );

        if (!tutor) {
            return sendError(res, 404, 'Tutor profile not found', 'NOT_FOUND');
        }

        return res.status(200).json({
            success: true,
            message: 'Step 1 completed successfully',
            data: formatOnboardingProfile(tutor)
        });
    } catch (error) {
        console.error('Tutor Onboarding Step 1 Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
});

// POST /api/tutor/onboarding/documents
router.post(
    '/documents',
    authMiddleware,
    (req, res, next) => {
        if (!requireTutor(req, res)) return;
        next();
    },
    tutorDocumentUpload,
    handleMulterError,
    async (req, res) => {
        try {
            const cnicFrontFile = req.files?.cnicFront?.[0];
            const cnicBackFile = req.files?.cnicBack?.[0];
            const degreeFile = req.files?.degree?.[0];

            if (!cnicFrontFile || !cnicBackFile || !degreeFile) {
                cleanupUploadedFiles(req.files);
                return sendError(
                    res,
                    400,
                    'cnicFront, cnicBack, and degree files are all required',
                    'VALIDATION_ERROR'
                );
            }

            const existingTutor = await Tutor.findOne({ user: req.user._id }).select(
                'onboardingStep cnicFrontUrl cnicBackUrl degreeCertificateUrl'
            );

            if (!existingTutor) {
                cleanupUploadedFiles(req.files);
                return sendError(res, 404, 'Tutor profile not found', 'NOT_FOUND');
            }

            if (existingTutor.onboardingStep < 2) {
                cleanupUploadedFiles(req.files);
                return sendError(
                    res,
                    400,
                    'Complete Step 1 before uploading documents',
                    'ONBOARDING_STEP_INVALID'
                );
            }

            const userId = req.user._id.toString();
            const cnicFrontUrl = buildPublicDocumentPath(userId, cnicFrontFile.filename);
            const cnicBackUrl = buildPublicDocumentPath(userId, cnicBackFile.filename);
            const degreeCertificateUrl = buildPublicDocumentPath(userId, degreeFile.filename);
            const documentsSubmittedAt = new Date();

            const tutor = await Tutor.findOneAndUpdate(
                { user: req.user._id },
                {
                    $set: {
                        cnicFrontUrl,
                        cnicBackUrl,
                        degreeCertificateUrl,
                        documentsSubmittedAt,
                        onboardingStep: 3,
                        onboardingStatus: 'under_review',
                        rejectionReason: ''
                    }
                },
                { new: true, runValidators: true }
            );

            deleteLocalDocument(existingTutor.cnicFrontUrl);
            deleteLocalDocument(existingTutor.cnicBackUrl);
            deleteLocalDocument(existingTutor.degreeCertificateUrl);

            return res.status(200).json({
                success: true,
                message: 'Documents uploaded successfully',
                data: formatDocumentUploadResponse(tutor)
            });
        } catch (error) {
            cleanupUploadedFiles(req.files);
            console.error('Tutor Onboarding Documents Error:', error);
            return res.status(500).json({
                success: false,
                message: 'Server Error',
                error: error.message
            });
        }
    }
);

// POST /api/tutor/onboarding/interview
router.post('/interview', authMiddleware, async (req, res) => {
    try {
        if (!requireTutor(req, res)) return;

        const validation = parseInterviewDate(req.body.interviewDate);
        if (!validation.valid) {
            return sendError(res, 400, validation.message, validation.code);
        }

        const existingTutor = await Tutor.findOne({ user: req.user._id }).select('onboardingStatus');

        if (!existingTutor) {
            return sendError(res, 404, 'Tutor profile not found', 'NOT_FOUND');
        }

        if (existingTutor.onboardingStatus !== 'under_review') {
            return sendError(
                res,
                400,
                'Interview can only be scheduled while documents are under review',
                'ONBOARDING_STATUS_INVALID'
            );
        }

        const tutor = await Tutor.findOneAndUpdate(
            { user: req.user._id },
            {
                $set: {
                    interviewScheduledAt: validation.interviewDate,
                    onboardingStatus: 'interview_scheduled'
                }
            },
            { new: true, runValidators: true }
        );

        return res.status(200).json({
            success: true,
            message: 'Interview scheduled successfully',
            data: formatInterviewResponse(tutor)
        });
    } catch (error) {
        console.error('Tutor Onboarding Interview Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
});

module.exports = router;
