const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    firebaseUid: { 
        type: String, 
        required: true, 
        unique: true 
    },
    name: { 
        type: String, 
        required: true 
    },
    email: { 
        type: String, 
        required: true, 
        unique: true 
    },
    password: { 
        type: String, 
        required: false 
    },
    phoneNumber: { 
        type: String, 
        required: false // SMS functionality ke liye
    },
    role: { 
        type: String, 
        required: true, 
        enum: ['student', 'tutor', 'parent'], 
        default: 'student' 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model('User', UserSchema);