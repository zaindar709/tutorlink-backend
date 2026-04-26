const mongoose = require('mongoose');

const tutorSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    qualification: { type: String, default: '' },
    experience: { type: String, default: '' },
    hourlyRate: { type: Number, default: 0 },
    subjects: [String],
    isVerified: { type: Boolean, default: false }
});

module.exports = mongoose.model('Tutor', tutorSchema);