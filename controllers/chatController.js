const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Booking = require('../models/Booking');
const Message = require('../models/Message');
const { buildMediaPayload, cleanupChatMediaFile } = require('../utils/chatMediaUpload');
const { emitNewMessage } = require('../utils/socket');
const { createSystemMessage } = require('../utils/chatSystemMessage');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DELETE_FOR_EVERYONE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const TEXT_LIKE_TYPES = new Set(['text', 'system', 'session', 'location']);
const MEDIA_MESSAGE_TYPES = new Set(['image', 'pdf', 'document', 'voice', 'homework']);

function sendError(res, status, message, code) {
    return res.status(status).json({ success: false, message, code });
}

function parsePagination(query) {
    const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
    const skip = (page - 1) * limit;
    return { page, limit, skip };
}

function isBookingParticipant(booking, userId) {
    const id = userId.toString();
    return booking.student.toString() === id || booking.tutor.toString() === id;
}

function isConversationParticipant(conversation, userId) {
    const id = userId.toString();
    return conversation.participants.some((participant) => {
        const participantId = participant._id ? participant._id.toString() : participant.toString();
        return participantId === id;
    });
}

function formatConversation(conversation) {
    return {
        _id: conversation._id,
        student: conversation.student,
        tutor: conversation.tutor,
        booking: conversation.booking,
        participants: conversation.participants,
        subject: conversation.subject,
        lastMessage: conversation.lastMessage,
        lastMessageTime: conversation.lastMessageTime,
        archivedUsers: conversation.archivedUsers,
        pinnedUsers: conversation.pinnedUsers,
        deletedUsers: conversation.deletedUsers,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt
    };
}

function formatMessage(message) {
    if (message.deletedForEveryone) {
        return {
            _id: message._id,
            conversationId: message.conversationId,
            sender: message.sender || null,
            messageType: 'system',
            text: 'This message was deleted',
            status: message.status,
            media: {},
            replyTo: null,
            reactions: [],
            deletedForEveryone: true,
            editedAt: null,
            createdAt: message.createdAt,
            updatedAt: message.updatedAt
        };
    }

    return {
        _id: message._id,
        conversationId: message.conversationId,
        sender: message.sender || null,
        messageType: message.messageType,
        text: message.text,
        status: message.status,
        media: message.media,
        replyTo: message.replyTo,
        reactions: message.reactions,
        deletedForEveryone: false,
        editedAt: message.editedAt,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
    };
}

function previewTextForConversation(message) {
    if (message.deletedForEveryone) return 'This message was deleted';
    if (message.text && message.text.trim()) return message.text.trim().slice(0, 200);
    if (message.messageType === 'image') return '📷 Photo';
    if (message.messageType === 'voice') return '🎤 Voice message';
    if (message.messageType === 'pdf' || message.messageType === 'document') return '📎 Document';
    if (message.messageType === 'homework') return '📝 Homework';
    if (message.messageType === 'location') return '📍 Location';
    return 'New message';
}

async function loadConversationOrRespond(conversationId, userId, res) {
    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
        sendError(res, 400, 'Valid conversationId is required', 'VALIDATION_ERROR');
        return null;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        sendError(res, 404, 'Conversation not found', 'NOT_FOUND');
        return null;
    }

    if (!isConversationParticipant(conversation, userId)) {
        sendError(res, 403, 'Forbidden: you are not a participant of this conversation', 'FORBIDDEN');
        return null;
    }

    return conversation;
}

async function loadMessageForParticipant(messageId, userId, res) {
    if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
        sendError(res, 400, 'Valid messageId is required', 'VALIDATION_ERROR');
        return null;
    }

    const message = await Message.findById(messageId);
    if (!message) {
        sendError(res, 404, 'Message not found', 'NOT_FOUND');
        return null;
    }

    const conversation = await loadConversationOrRespond(message.conversationId.toString(), userId, res);
    if (!conversation) return null;

    return { message, conversation };
}

/**
 * POST /api/chat/conversations
 */
async function createConversation(req, res) {
    try {
        const { bookingId } = req.body;

        if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
            return sendError(res, 400, 'Valid bookingId is required', 'VALIDATION_ERROR');
        }

        const booking = await Booking.findById(bookingId);
        if (!booking) {
            return sendError(res, 404, 'Booking not found', 'NOT_FOUND');
        }

        if (!isBookingParticipant(booking, req.user._id)) {
            return sendError(
                res,
                403,
                'Forbidden: only the booking student or tutor can open this conversation',
                'FORBIDDEN'
            );
        }

        const existing = await Conversation.findOne({ booking: bookingId })
            .populate('participants', 'name avatarUrl role')
            .populate('student', 'name avatarUrl role')
            .populate('tutor', 'name avatarUrl role');

        if (existing) {
            if (!isConversationParticipant(existing, req.user._id)) {
                return sendError(res, 403, 'Forbidden: you are not a participant of this conversation', 'FORBIDDEN');
            }

            return res.status(200).json({
                success: true,
                message: 'Conversation already exists',
                data: formatConversation(existing)
            });
        }

        const [conversation] = await Conversation.create([
            {
                student: booking.student,
                tutor: booking.tutor,
                booking: booking._id,
                participants: [booking.student, booking.tutor],
                subject: booking.subject,
                lastMessage: '',
                lastMessageTime: null
            }
        ]);

        const populated = await Conversation.findById(conversation._id)
            .populate('participants', 'name avatarUrl role')
            .populate('student', 'name avatarUrl role')
            .populate('tutor', 'name avatarUrl role');

        return res.status(201).json({
            success: true,
            message: 'Conversation created successfully',
            data: formatConversation(populated)
        });
    } catch (error) {
        if (error.code === 11000) {
            const existing = await Conversation.findOne({ booking: req.body.bookingId })
                .populate('participants', 'name avatarUrl role')
                .populate('student', 'name avatarUrl role')
                .populate('tutor', 'name avatarUrl role');

            if (existing) {
                return res.status(200).json({
                    success: true,
                    message: 'Conversation already exists',
                    data: formatConversation(existing)
                });
            }
        }

        console.error('Create Conversation Error:', error);
        return sendError(res, 500, 'Server Error', 'SERVER_ERROR');
    }
}

/**
 * GET /api/chat/conversations
 */
async function listConversations(req, res) {
    try {
        const userId = req.user._id;

        const conversations = await Conversation.find({
            participants: userId,
            deletedUsers: { $ne: userId }
        })
            .populate('participants', 'name avatarUrl role')
            .populate('student', 'name avatarUrl role')
            .populate('tutor', 'name avatarUrl role')
            .sort({ lastMessageTime: -1, updatedAt: -1 });

        return res.status(200).json({
            success: true,
            data: conversations.map(formatConversation)
        });
    } catch (error) {
        console.error('List Conversations Error:', error);
        return sendError(res, 500, 'Server Error', 'SERVER_ERROR');
    }
}

/**
 * GET /api/chat/conversations/:conversationId/messages
 */
async function listMessages(req, res) {
    try {
        const conversation = await loadConversationOrRespond(
            req.params.conversationId,
            req.user._id,
            res
        );
        if (!conversation) return;

        const { page, limit, skip } = parsePagination(req.query);
        const userId = req.user._id;

        const filter = {
            conversationId: conversation._id,
            deletedFor: { $ne: userId }
        };

        const [total, messages] = await Promise.all([
            Message.countDocuments(filter),
            Message.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('sender', 'name avatarUrl role')
                .populate({
                    path: 'replyTo',
                    select: 'text sender messageType deletedForEveryone',
                    populate: { path: 'sender', select: 'name avatarUrl role' }
                })
        ]);

        return res.status(200).json({
            success: true,
            data: {
                messages: messages.map(formatMessage),
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit) || 1
                }
            }
        });
    } catch (error) {
        console.error('List Messages Error:', error);
        return sendError(res, 500, 'Server Error', 'SERVER_ERROR');
    }
}

/**
 * POST /api/chat/conversations/:conversationId/messages
 */
async function sendMessage(req, res) {
    try {
        const conversation = await loadConversationOrRespond(
            req.params.conversationId,
            req.user._id,
            res
        );
        if (!conversation) return;

        const {
            text = '',
            messageType = 'text',
            replyTo = null,
            media = null,
            duration = 0
        } = req.body;

        if (!Message.schema.path('messageType').enumValues.includes(messageType)) {
            return sendError(res, 400, 'Invalid messageType', 'VALIDATION_ERROR');
        }

        const trimmedText = typeof text === 'string' ? text.trim() : '';

        if (TEXT_LIKE_TYPES.has(messageType) && !trimmedText && messageType === 'text') {
            return sendError(res, 400, 'text is required for text messages', 'VALIDATION_ERROR');
        }

        let replyToId = null;
        if (replyTo) {
            if (!mongoose.Types.ObjectId.isValid(replyTo)) {
                return sendError(res, 400, 'Invalid replyTo message id', 'VALIDATION_ERROR');
            }

            const parentMessage = await Message.findById(replyTo);
            if (!parentMessage || parentMessage.conversationId.toString() !== conversation._id.toString()) {
                return sendError(res, 400, 'replyTo message not found in this conversation', 'VALIDATION_ERROR');
            }
            replyToId = parentMessage._id;
        }

        let mediaPayload = buildMediaPayload(null);
        if (media && typeof media === 'object') {
            mediaPayload = {
                url: media.url || '',
                thumbnail: media.thumbnail || '',
                fileName: media.fileName || '',
                fileSize: Number(media.fileSize) || 0,
                mimeType: media.mimeType || '',
                duration: Number(media.duration ?? duration) || 0
            };
        }

        if (MEDIA_MESSAGE_TYPES.has(messageType) && !mediaPayload.url && !req.file) {
            return sendError(res, 400, 'media payload or file is required for this messageType', 'VALIDATION_ERROR');
        }

        const message = await Message.create({
            conversationId: conversation._id,
            sender: req.user._id,
            messageType,
            text: trimmedText,
            status: 'sent',
            media: mediaPayload,
            replyTo: replyToId
        });

        const lastMessageTime = message.createdAt;
        await Conversation.findByIdAndUpdate(conversation._id, {
            lastMessage: previewTextForConversation(message),
            lastMessageTime
        });

        const populated = await Message.findById(message._id)
            .populate('sender', 'name avatarUrl role')
            .populate({
                path: 'replyTo',
                select: 'text sender messageType deletedForEveryone',
                populate: { path: 'sender', select: 'name avatarUrl role' }
            });

        const payload = formatMessage(populated);
        emitNewMessage(conversation._id, payload);

        return res.status(201).json({
            success: true,
            message: 'Message sent successfully',
            data: payload
        });
    } catch (error) {
        console.error('Send Message Error:', error);
        return sendError(res, 500, 'Server Error', 'SERVER_ERROR');
    }
}

/**
 * POST /api/chat/conversations/:conversationId/messages/media
 * Multipart upload shell — stores file locally (or cloud URL later) and creates a media message.
 */
async function sendMediaMessage(req, res) {
    try {
        const conversation = await loadConversationOrRespond(
            req.params.conversationId,
            req.user._id,
            res
        );
        if (!conversation) {
            cleanupChatMediaFile(req.file);
            return;
        }

        if (!req.file) {
            return sendError(res, 400, 'file is required (multipart field name: file)', 'VALIDATION_ERROR');
        }

        const messageType = req.body.messageType || 'document';
        if (!MEDIA_MESSAGE_TYPES.has(messageType)) {
            cleanupChatMediaFile(req.file);
            return sendError(
                res,
                400,
                `messageType must be one of: ${[...MEDIA_MESSAGE_TYPES].join(', ')}`,
                'VALIDATION_ERROR'
            );
        }

        const mediaPayload = buildMediaPayload(req.file, {
            conversationId: conversation._id,
            duration: req.body.duration,
            thumbnail: req.body.thumbnail
        });

        const trimmedText = typeof req.body.text === 'string' ? req.body.text.trim() : '';

        let replyToId = null;
        if (req.body.replyTo) {
            if (!mongoose.Types.ObjectId.isValid(req.body.replyTo)) {
                cleanupChatMediaFile(req.file);
                return sendError(res, 400, 'Invalid replyTo message id', 'VALIDATION_ERROR');
            }
            const parentMessage = await Message.findById(req.body.replyTo);
            if (!parentMessage || parentMessage.conversationId.toString() !== conversation._id.toString()) {
                cleanupChatMediaFile(req.file);
                return sendError(res, 400, 'replyTo message not found in this conversation', 'VALIDATION_ERROR');
            }
            replyToId = parentMessage._id;
        }

        const message = await Message.create({
            conversationId: conversation._id,
            sender: req.user._id,
            messageType,
            text: trimmedText,
            status: 'sent',
            media: mediaPayload,
            replyTo: replyToId
        });

        await Conversation.findByIdAndUpdate(conversation._id, {
            lastMessage: previewTextForConversation(message),
            lastMessageTime: message.createdAt
        });

        const populated = await Message.findById(message._id)
            .populate('sender', 'name avatarUrl role')
            .populate({
                path: 'replyTo',
                select: 'text sender messageType deletedForEveryone',
                populate: { path: 'sender', select: 'name avatarUrl role' }
            });

        const payload = formatMessage(populated);
        emitNewMessage(conversation._id, payload);

        return res.status(201).json({
            success: true,
            message: 'Media message sent successfully',
            data: payload
        });
    } catch (error) {
        cleanupChatMediaFile(req.file);
        console.error('Send Media Message Error:', error);
        return sendError(res, 500, 'Server Error', 'SERVER_ERROR');
    }
}

/**
 * PATCH /api/chat/messages/:messageId
 */
async function editMessage(req, res) {
    try {
        const loaded = await loadMessageForParticipant(req.params.messageId, req.user._id, res);
        if (!loaded) return;

        const { message } = loaded;

        if (message.sender.toString() !== req.user._id.toString()) {
            return sendError(res, 403, 'Forbidden: only the sender can edit this message', 'FORBIDDEN');
        }

        if (message.deletedForEveryone) {
            return sendError(res, 400, 'Cannot edit a deleted message', 'VALIDATION_ERROR');
        }

        if (message.messageType !== 'text') {
            return sendError(res, 400, 'Only text messages can be edited', 'VALIDATION_ERROR');
        }

        const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
        if (!text) {
            return sendError(res, 400, 'text is required', 'VALIDATION_ERROR');
        }

        message.text = text;
        message.editedAt = new Date();
        await message.save();

        const conversationDoc = await Conversation.findById(message.conversationId);
        if (
            conversationDoc &&
            conversationDoc.lastMessageTime &&
            new Date(conversationDoc.lastMessageTime).getTime() === new Date(message.createdAt).getTime()
        ) {
            conversationDoc.lastMessage = previewTextForConversation(message);
            await conversationDoc.save();
        }

        const populated = await Message.findById(message._id)
            .populate('sender', 'name avatarUrl role')
            .populate({
                path: 'replyTo',
                select: 'text sender messageType deletedForEveryone',
                populate: { path: 'sender', select: 'name avatarUrl role' }
            });

        return res.status(200).json({
            success: true,
            message: 'Message updated successfully',
            data: formatMessage(populated)
        });
    } catch (error) {
        console.error('Edit Message Error:', error);
        return sendError(res, 500, 'Server Error', 'SERVER_ERROR');
    }
}

/**
 * DELETE /api/chat/messages/:messageId
 * Body/query: deleteFor = 'me' | 'everyone' (default: 'me')
 */
async function deleteMessage(req, res) {
    try {
        const loaded = await loadMessageForParticipant(req.params.messageId, req.user._id, res);
        if (!loaded) return;

        const { message } = loaded;
        const deleteFor = (req.body.deleteFor || req.query.deleteFor || 'me').toString().toLowerCase();

        if (deleteFor !== 'me' && deleteFor !== 'everyone') {
            return sendError(res, 400, "deleteFor must be 'me' or 'everyone'", 'VALIDATION_ERROR');
        }

        if (deleteFor === 'me') {
            if (!message.deletedFor.some((id) => id.toString() === req.user._id.toString())) {
                message.deletedFor.push(req.user._id);
                await message.save();
            }

            return res.status(200).json({
                success: true,
                message: 'Message deleted for you',
                data: { messageId: message._id, deleteFor: 'me' }
            });
        }

        // Delete for everyone — sender only, within allowed window
        if (message.sender.toString() !== req.user._id.toString()) {
            return sendError(res, 403, 'Forbidden: only the sender can delete for everyone', 'FORBIDDEN');
        }

        const ageMs = Date.now() - new Date(message.createdAt).getTime();
        if (ageMs > DELETE_FOR_EVERYONE_WINDOW_MS) {
            return sendError(
                res,
                400,
                'Delete for everyone is only allowed within 1 hour of sending',
                'VALIDATION_ERROR'
            );
        }

        message.deletedForEveryone = true;
        message.text = '';
        message.media = buildMediaPayload(null);
        message.reactions = [];
        message.replyTo = null;
        await message.save();

        const conversationDoc = await Conversation.findById(message.conversationId);
        if (
            conversationDoc &&
            conversationDoc.lastMessageTime &&
            new Date(conversationDoc.lastMessageTime).getTime() === new Date(message.createdAt).getTime()
        ) {
            conversationDoc.lastMessage = 'This message was deleted';
            await conversationDoc.save();
        }

        return res.status(200).json({
            success: true,
            message: 'Message deleted for everyone',
            data: { messageId: message._id, deleteFor: 'everyone' }
        });
    } catch (error) {
        console.error('Delete Message Error:', error);
        return sendError(res, 500, 'Server Error', 'SERVER_ERROR');
    }
}

/**
 * POST /api/chat/messages/:messageId/reaction
 */
async function reactToMessage(req, res) {
    try {
        const loaded = await loadMessageForParticipant(req.params.messageId, req.user._id, res);
        if (!loaded) return;

        const { message } = loaded;

        if (message.deletedForEveryone) {
            return sendError(res, 400, 'Cannot react to a deleted message', 'VALIDATION_ERROR');
        }

        const emoji = typeof req.body.emoji === 'string' ? req.body.emoji.trim() : '';
        if (!emoji) {
            return sendError(res, 400, 'emoji is required', 'VALIDATION_ERROR');
        }

        const userId = req.user._id.toString();
        const existingIndex = message.reactions.findIndex(
            (reaction) => reaction.user.toString() === userId
        );

        if (existingIndex >= 0) {
            if (message.reactions[existingIndex].emoji === emoji) {
                // Same emoji again → remove reaction (toggle off)
                message.reactions.splice(existingIndex, 1);
            } else {
                message.reactions[existingIndex].emoji = emoji;
            }
        } else {
            message.reactions.push({ user: req.user._id, emoji });
        }

        await message.save();

        const populated = await Message.findById(message._id)
            .populate('sender', 'name avatarUrl role')
            .populate('reactions.user', 'name avatarUrl role');

        return res.status(200).json({
            success: true,
            message: 'Reaction updated successfully',
            data: formatMessage(populated)
        });
    } catch (error) {
        console.error('React To Message Error:', error);
        return sendError(res, 500, 'Server Error', 'SERVER_ERROR');
    }
}

module.exports = {
    createConversation,
    listConversations,
    listMessages,
    sendMessage,
    sendMediaMessage,
    editMessage,
    deleteMessage,
    reactToMessage,
    createSystemMessage
};
