const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const homeService = require('../services/homeService');
const { HomeServiceError } = require('../services/homeService');

function sendError(res, status, message, code) {
    return res.status(status).json({ success: false, message, code });
}

function handleHomeError(res, error, context) {
    if (error instanceof HomeServiceError) {
        return sendError(res, error.statusCode, error.message, error.code);
    }

    console.error(`${context}:`, error);
    return res.status(500).json({
        success: false,
        message: 'Server Error',
        error: error.message
    });
}

// GET /api/home/dashboard
router.get('/dashboard', authMiddleware, async (req, res) => {
    try {
        const data = await homeService.getStudentDashboard(req.user._id);

        return res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        return handleHomeError(res, error, 'Get Dashboard Error');
    }
});

module.exports = router;
