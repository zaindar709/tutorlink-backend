const mongoose = require('mongoose');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { emitNewMessage } = require('./socket');

const SYSTEM_TYPES = new Set(['system', 'session']);

function formatSystemMessage(message) {
    return {
        _id: message._id,
        conversationId: message.conversationId,
        sender: null,
        messageType: message.messageType,
        text: message.text,
        status: message.status,
        media: message.media || {},
        replyTo: null,
        reactions: [],
        deletedForEveryone: false,
        editedAt: null,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
    };
}

/**
 * Insert a system/session message and broadcast it to the conversation room.
 * @param {string|ObjectId} conversationId
 * @param {string} text
 * @param {'system'|'session'} [type='system']
 * @returns {Promise<object>} formatted message payload
 */
async function createSystemMessage(conversationId, text, type = 'system') {
    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
        throw new Error('Valid conversationId is required');
    }

    const trimmedText = typeof text === 'string' ? text.trim() : '';
    if (!trimmedText) {
        throw new Error('System message text is required');
    }

    const messageType = SYSTEM_TYPES.has(type) ? type : 'system';

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        throw new Error('Conversation not found');
    }

    const message = await Message.create({
        conversationId: conversation._id,
        sender: null,
        messageType,
        text: trimmedText,
        status: 'sent',
        media: {},
        replyTo: null,
        reactions: []
    });

    await Conversation.findByIdAndUpdate(conversation._id, {
        lastMessage: trimmedText.slice(0, 200),
        lastMessageTime: message.createdAt
    });

    const payload = formatSystemMessage(message);
    emitNewMessage(conversation._id, payload);

    return payload;
}

module.exports = {
    createSystemMessage,
    formatSystemMessage
};
