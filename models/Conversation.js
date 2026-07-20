const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
    {
        student: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        tutor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        booking: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Booking',
            required: true,
            unique: true
        },
        participants: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            }
        ],
        subject: {
            type: String,
            required: true,
            trim: true
        },
        lastMessage: {
            type: String,
            default: ''
        },
        lastMessageTime: {
            type: Date,
            default: null
        },
        archivedUsers: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            }
        ],
        pinnedUsers: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            }
        ],
        deletedUsers: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            }
        ]
    },
    { timestamps: true }
);

conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessageTime: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
