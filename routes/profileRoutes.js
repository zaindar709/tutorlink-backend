const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const profileService = require('../services/profileService');
const parentLinkService = require('../services/parentLinkService');
const { ProfileServiceError } = require('../services/profileService');
const { ParentLinkServiceError } = require('../services/parentLinkService');

function sendError(res, status, message, code) {
    return res.status(status).json({ success: false, message, code });
}

function handleProfileError(res, error, context) {
    if (error instanceof ProfileServiceError || error instanceof ParentLinkServiceError) {
        return sendError(res, error.statusCode, error.message, error.code);
    }

    console.error(`${context}:`, error);
    return res.status(500).json({
        success: false,
        message: 'Server Error',
        error: error.message
    });
}

function requireRole(req, res, role) {
    if (req.user.role !== role) {
        sendError(res, 403, `Only ${role}s can access this resource`, 'FORBIDDEN');
        return false;
    }
    return true;
}

// GET /api/profile/me
router.get('/me', authMiddleware, async (req, res) => {
    try {
        if (!requireRole(req, res, 'student')) return;

        const data = await profileService.getStudentProfile(req.user._id);

        return res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        return handleProfileError(res, error, 'Get Profile Error');
    }
});

// PATCH /api/profile/me
router.patch('/me', authMiddleware, async (req, res) => {
    try {
        if (!requireRole(req, res, 'student')) return;

        const { name, phoneNumber, avatarUrl, grade, board } = req.body;

        const data = await profileService.updateStudentProfile(req.user._id, {
            name,
            phoneNumber,
            avatarUrl,
            grade,
            board
        });

        return res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data
        });
    } catch (error) {
        return handleProfileError(res, error, 'Update Profile Error');
    }
});

// PUT /api/profile/interests
router.put('/interests', authMiddleware, async (req, res) => {
    try {
        if (!requireRole(req, res, 'student')) return;

        const { interests } = req.body;

        const data = await profileService.updateInterests(req.user._id, interests);

        return res.status(200).json({
            success: true,
            message: 'Interests updated successfully',
            data
        });
    } catch (error) {
        return handleProfileError(res, error, 'Update Interests Error');
    }
});

// POST /api/profile/link-code/generate
router.post('/link-code/generate', authMiddleware, async (req, res) => {
    try {
        if (!requireRole(req, res, 'student')) return;

        const data = await parentLinkService.generateLinkCode(req.user._id);

        return res.status(201).json({
            success: true,
            message: 'Link code generated successfully',
            data
        });
    } catch (error) {
        return handleProfileError(res, error, 'Generate Link Code Error');
    }
});

// POST /api/profile/link-code/redeem
router.post('/link-code/redeem', authMiddleware, async (req, res) => {
    try {
        if (!requireRole(req, res, 'parent')) return;

        const { code } = req.body;

        if (!code || typeof code !== 'string') {
            return sendError(res, 400, 'code is required', 'VALIDATION_ERROR');
        }

        const data = await parentLinkService.redeemLinkCode(req.user._id, code);

        return res.status(200).json({
            success: true,
            message: data.message,
            data
        });
    } catch (error) {
        return handleProfileError(res, error, 'Redeem Link Code Error');
    }
});

module.exports = router;
