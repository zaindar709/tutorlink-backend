const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema(
    {
        url: { type: String, default: '' },
        thumbnail: { type: String, default: '' },
        fileName: { type: String, default: '' },
        fileSize: { type: Number, default: 0 },
        mimeType: { type: String, default: '' },
        duration: { type: Number, default: 0 }
    },
    { _id: false }
);

const reactionSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        emoji: {
            type: String,
            required: true,
            trim: true
        }
    },
    { _id: false }
);

const messageSchema = new mongoose.Schema(
    {
        conversationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Conversation',
            required: true,
            index: true
        },
        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: false,
            default: null
        },
        messageType: {
            type: String,
            enum: ['text', 'image', 'pdf', 'document', 'voice', 'homework', 'location', 'system', 'session'],
            required: true,
            default: 'text'
        },
        text: {
            type: String,
            default: ''
        },
        status: {
            type: String,
            enum: ['sending', 'sent', 'delivered', 'seen'],
            default: 'sent'
        },
        media: {
            type: mediaSchema,
            default: () => ({})
        },
        replyTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Message',
            default: null
        },
        reactions: {
            type: [reactionSchema],
            default: []
        },
        // Soft delete: hide message only for listed users ("Delete for Me")
        deletedFor: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            }
        ],
        // Hard soft-delete for all participants ("Delete for Everyone")
        deletedForEveryone: {
            type: Boolean,
            default: false
        },
        editedAt: {
            type: Date,
            default: null
        }
    },
    { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
