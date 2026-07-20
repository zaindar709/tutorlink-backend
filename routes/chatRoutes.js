const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const chatController = require('../controllers/chatController');
const { chatMediaUpload } = require('../utils/chatMediaUpload');

function handleChatMediaUpload(req, res, next) {
    chatMediaUpload(req, res, (error) => {
        if (!error) return next();

        if (error instanceof Error) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    success: false,
                    message: 'File too large (max 25MB)',
                    code: 'VALIDATION_ERROR'
                });
            }

            return res.status(400).json({
                success: false,
                message: error.message || 'File upload failed',
                code: 'VALIDATION_ERROR'
            });
        }

        return res.status(400).json({
            success: false,
            message: 'File upload failed',
            code: 'VALIDATION_ERROR'
        });
    });
}

router.use(authMiddleware);

// Conversations
router.post('/conversations', chatController.createConversation);
router.get('/conversations', chatController.listConversations);

// Messages in a conversation
router.get('/conversations/:conversationId/messages', chatController.listMessages);
router.post('/conversations/:conversationId/messages', chatController.sendMessage);
router.post(
    '/conversations/:conversationId/messages/media',
    handleChatMediaUpload,
    chatController.sendMediaMessage
);

// Message updates
router.patch('/messages/:messageId', chatController.editMessage);
router.delete('/messages/:messageId', chatController.deleteMessage);
router.post('/messages/:messageId/reaction', chatController.reactToMessage);

module.exports = router;
