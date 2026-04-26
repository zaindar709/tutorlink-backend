const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    grade: { type: String, default: '' },
    board: { type: String, default: '' },
    subjects: [String]
});

module.exports = mongoose.model('Student', studentSchema);