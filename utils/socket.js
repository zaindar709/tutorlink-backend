const { Server } = require('socket.io');
const admin = require('firebase-admin');
const mongoose = require('mongoose');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

/** @type {import('socket.io').Server | null} */
let io = null;

/** userId -> Set<socketId> */
const onlineUsers = new Map();

const STATUS_RANK = {
    sending: 0,
    sent: 1,
    delivered: 2,
    seen: 3
};

function getIO() {
    if (!io) {
        throw new Error('Socket.io has not been initialized');
    }
    return io;
}

function isUserOnline(userId) {
    const sockets = onlineUsers.get(userId.toString());
    return Boolean(sockets && sockets.size > 0);
}

function getOnlineUserIds() {
    return [...onlineUsers.keys()].filter((userId) => onlineUsers.get(userId)?.size > 0);
}

function registerSocket(userId, socketId) {
    const key = userId.toString();
    if (!onlineUsers.has(key)) {
        onlineUsers.set(key, new Set());
    }
    onlineUsers.get(key).add(socketId);
}

function unregisterSocket(userId, socketId) {
    const key = userId.toString();
    const sockets = onlineUsers.get(key);
    if (!sockets) return false;

    sockets.delete(socketId);
    if (sockets.size === 0) {
        onlineUsers.delete(key);
        return true; // fully offline
    }
    return false;
}

function extractToken(socket) {
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) {
        return authToken.startsWith('Bearer ') ? authToken.slice(7) : authToken.trim();
    }

    const header = socket.handshake.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
        return header.slice(7).trim();
    }

    const queryToken = socket.handshake.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim()) {
        return queryToken.startsWith('Bearer ') ? queryToken.slice(7) : queryToken.trim();
    }

    return null;
}

async function authenticateSocket(socket, next) {
    try {
        const token = extractToken(socket);
        if (!token) {
            return next(new Error('Unauthorized: No token provided'));
        }

        const decoded = await admin.auth().verifyIdToken(token);
        const user = await User.findOne({ firebaseUid: decoded.uid });
        if (!user) {
            return next(new Error('Unauthorized: User profile not found'));
        }

        socket.user = user;
        socket.firebase = decoded;
        return next();
    } catch (error) {
        console.error('Socket auth error:', error.message);
        return next(new Error('Unauthorized: Invalid or expired token'));
    }
}

function isConversationParticipant(conversation, userId) {
    const id = userId.toString();
    return conversation.participants.some((participant) => participant.toString() === id);
}

async function loadParticipantConversation(conversationId, userId) {
    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
        return { error: 'Valid conversationId is required' };
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        return { error: 'Conversation not found' };
    }

    if (!isConversationParticipant(conversation, userId)) {
        return { error: 'Forbidden: not a conversation participant' };
    }

    return { conversation };
}

async function notifyPartnersStatus(userId, status) {
    if (!io) return;

    try {
        const conversations = await Conversation.find({ participants: userId }).select('participants');
        const partnerIds = new Set();

        conversations.forEach((conversation) => {
            conversation.participants.forEach((participantId) => {
                if (participantId.toString() !== userId.toString()) {
                    partnerIds.add(participantId.toString());
                }
            });
        });

        const payload = {
            userId: userId.toString(),
            status
        };

        partnerIds.forEach((partnerId) => {
            const sockets = onlineUsers.get(partnerId);
            if (!sockets) return;
            sockets.forEach((socketId) => {
                io.to(socketId).emit('user-status', payload);
            });
        });
    } catch (error) {
        console.error('Notify user status error:', error.message);
    }
}

/**
 * Emit a new message to everyone in the conversation room (including sender if joined).
 */
function emitNewMessage(conversationId, messagePayload) {
    if (!io) {
        console.warn('emitNewMessage skipped: Socket.io not initialized');
        return;
    }

    const room = conversationId.toString();
    io.to(room).emit('new-message', messagePayload);
}

function emitMessageStatusUpdated(conversationId, messageId, status) {
    if (!io) return;
    io.to(conversationId.toString()).emit('message-status-updated', {
        messageId: messageId.toString(),
        status
    });
}

function canUpgradeStatus(currentStatus, nextStatus) {
    return (STATUS_RANK[nextStatus] || 0) > (STATUS_RANK[currentStatus] || 0);
}

async function updateMessageReceiptStatus({ conversationId, messageId, userId, nextStatus, requireRecipient }) {
    if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
        return { error: 'Valid messageId is required' };
    }

    const { conversation, error } = await loadParticipantConversation(conversationId, userId);
    if (error) return { error };

    const message = await Message.findById(messageId);
    if (!message || message.conversationId.toString() !== conversation._id.toString()) {
        return { error: 'Message not found in this conversation' };
    }

    if (message.deletedForEveryone) {
        return { error: 'Cannot update status of a deleted message' };
    }

    // System messages have no sender — skip receipt updates
    if (!message.sender) {
        return { error: 'Cannot update status of a system message' };
    }

    if (requireRecipient && message.sender.toString() === userId.toString()) {
        return { error: 'Forbidden: only the recipient can mark this message as seen' };
    }

    // Delivered should also be recipient-driven (not the original sender)
    if (nextStatus === 'delivered' && message.sender.toString() === userId.toString()) {
        return { error: 'Forbidden: only the recipient can mark this message as delivered' };
    }

    if (!canUpgradeStatus(message.status, nextStatus)) {
        return {
            skipped: true,
            message,
            conversation,
            status: message.status
        };
    }

    message.status = nextStatus;
    await message.save();

    return { message, conversation, status: nextStatus };
}

function initSocket(httpServer) {
    const allowedOrigins = process.env.SOCKET_CORS_ORIGIN
        ? process.env.SOCKET_CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
        : true; // mobile clients / Expo often need flexible CORS

    io = new Server(httpServer, {
        cors: {
            origin: allowedOrigins,
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    io.use(authenticateSocket);

    io.on('connection', async (socket) => {
        const userId = socket.user._id.toString();
        registerSocket(userId, socket.id);

        console.log(`🔌 Socket connected: user=${userId} socket=${socket.id}`);

        socket.emit('connected', {
            userId,
            status: 'online'
        });

        // First active socket for this user → broadcast online to chat partners
        if (onlineUsers.get(userId)?.size === 1) {
            await notifyPartnersStatus(userId, 'online');
        }

        /**
         * Client → join-conversation { conversationId }
         * Server validates participant, then socket.join(conversationId)
         */
        socket.on('join-conversation', async (payload = {}, ack) => {
            try {
                const conversationId = payload.conversationId;
                const { conversation, error } = await loadParticipantConversation(
                    conversationId,
                    socket.user._id
                );

                if (error) {
                    const failure = { success: false, message: error };
                    if (typeof ack === 'function') ack(failure);
                    socket.emit('join-conversation-error', failure);
                    return;
                }

                const room = conversation._id.toString();
                await socket.join(room);

                const success = {
                    success: true,
                    conversationId: room,
                    message: 'Joined conversation room'
                };
                if (typeof ack === 'function') ack(success);
                socket.emit('joined-conversation', success);
            } catch (error) {
                console.error('join-conversation error:', error.message);
                const failure = { success: false, message: 'Failed to join conversation' };
                if (typeof ack === 'function') ack(failure);
                socket.emit('join-conversation-error', failure);
            }
        });

        socket.on('leave-conversation', async (payload = {}) => {
            const conversationId = payload.conversationId;
            if (!conversationId) return;
            await socket.leave(conversationId.toString());
        });

        /**
         * Typing indicators
         * Client → typing | stop-typing { conversationId }
         */
        socket.on('typing', async (payload = {}) => {
            try {
                const { conversation, error } = await loadParticipantConversation(
                    payload.conversationId,
                    socket.user._id
                );
                if (error) return;

                const room = conversation._id.toString();
                io.to(room).emit('user-typing', {
                    conversationId: room,
                    userId
                });
            } catch (error) {
                console.error('typing error:', error.message);
            }
        });

        socket.on('stop-typing', async (payload = {}) => {
            try {
                const { conversation, error } = await loadParticipantConversation(
                    payload.conversationId,
                    socket.user._id
                );
                if (error) return;

                const room = conversation._id.toString();
                io.to(room).emit('user-stop-typing', {
                    conversationId: room,
                    userId
                });
            } catch (error) {
                console.error('stop-typing error:', error.message);
            }
        });

        /**
         * Delivery & read receipts
         * Client → message-delivered | message-seen { conversationId, messageId }
         */
        socket.on('message-delivered', async (payload = {}, ack) => {
            try {
                const result = await updateMessageReceiptStatus({
                    conversationId: payload.conversationId,
                    messageId: payload.messageId,
                    userId: socket.user._id,
                    nextStatus: 'delivered',
                    requireRecipient: false
                });

                if (result.error) {
                    if (typeof ack === 'function') ack({ success: false, message: result.error });
                    return;
                }

                if (!result.skipped) {
                    emitMessageStatusUpdated(result.conversation._id, result.message._id, 'delivered');
                }

                if (typeof ack === 'function') {
                    ack({
                        success: true,
                        messageId: result.message._id.toString(),
                        status: result.status
                    });
                }
            } catch (error) {
                console.error('message-delivered error:', error.message);
                if (typeof ack === 'function') ack({ success: false, message: 'Failed to update delivery status' });
            }
        });

        socket.on('message-seen', async (payload = {}, ack) => {
            try {
                const result = await updateMessageReceiptStatus({
                    conversationId: payload.conversationId,
                    messageId: payload.messageId,
                    userId: socket.user._id,
                    nextStatus: 'seen',
                    requireRecipient: true
                });

                if (result.error) {
                    if (typeof ack === 'function') ack({ success: false, message: result.error });
                    return;
                }

                if (!result.skipped) {
                    emitMessageStatusUpdated(result.conversation._id, result.message._id, 'seen');
                }

                if (typeof ack === 'function') {
                    ack({
                        success: true,
                        messageId: result.message._id.toString(),
                        status: result.status
                    });
                }
            } catch (error) {
                console.error('message-seen error:', error.message);
                if (typeof ack === 'function') ack({ success: false, message: 'Failed to update seen status' });
            }
        });

        /**
         * Optional helper for chat list: check which of these users are online.
         * Client → check-online-status { userIds: string[] }
         */
        socket.on('check-online-status', (payload = {}, ack) => {
            const userIds = Array.isArray(payload.userIds) ? payload.userIds : [];
            const statuses = userIds.map((id) => ({
                userId: id.toString(),
                status: isUserOnline(id) ? 'online' : 'offline'
            }));

            if (typeof ack === 'function') {
                ack({ success: true, data: statuses });
            } else {
                socket.emit('online-status', { data: statuses });
            }
        });

        socket.on('disconnect', async () => {
            const wentOffline = unregisterSocket(userId, socket.id);
            console.log(`🔌 Socket disconnected: user=${userId} socket=${socket.id}`);

            if (wentOffline) {
                await notifyPartnersStatus(userId, 'offline');
            }
        });
    });

    console.log('🔌 Socket.io initialized');
    return io;
}

module.exports = {
    initSocket,
    getIO,
    emitNewMessage,
    isUserOnline,
    getOnlineUserIds
};
