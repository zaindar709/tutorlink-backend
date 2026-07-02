const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
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
    subject: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    startTime: {
        type: String,
        required: true
    },
    endTime: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'completed', 'cancelled'],
        default: 'pending'
    },
    hourlyRateAtBooking: {
        type: Number,
        required: true
    },
    meetingLink: {
        type: String,
        default: ''
    }
}, { timestamps: true });

bookingSchema.index({ student: 1, date: 1 });
bookingSchema.index({ tutor: 1, date: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
