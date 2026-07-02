const mongoose = require('mongoose');

const userPreferencesSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    notifications: {
        sessionReminders: {
            type: Boolean,
            default: true
        },
        bookingUpdates: {
            type: Boolean,
            default: true
        },
        promotions: {
            type: Boolean,
            default: false
        }
    },
    privacy: {
        showProfileToTutors: {
            type: Boolean,
            default: true
        },
        showOnlineStatus: {
            type: Boolean,
            default: true
        }
    },
    app: {
        language: {
            type: String,
            default: 'en'
        },
        theme: {
            type: String,
            default: 'system'
        }
    }
}, { timestamps: true });

userPreferencesSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('UserPreferences', userPreferencesSchema);
