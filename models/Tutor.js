const mongoose = require('mongoose');

const tutorSchema = new mongoose.Schema({

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    qualification: { type: String, default: '' },
    experience: { type: String, default: '' }, // e.g., '3 Years'
    experienceYears: { type: Number, default: 0 }, // Filter ke liye number zaroori hai
    hourlyRate: { type: Number, default: 0 }, // (Fee Range filter ke liye)
    subjects: [String], // e.g., ['Mathematics', 'Physics']
    isVerified: { type: Boolean, default: false },
    gender: { type: String, enum: ['Male', 'Female', 'Other'], default: 'Male' },
    grades: [String], // Class/Grade filter ke liye (e.g., ['Grade 9', 'O-Level'])
    teachingMode: { type: String, enum: ['Online', 'In-Person', 'Both'], default: 'Both' },
    rating: { type: Number, default: 4.0 },
    availability: { type: Boolean, default: true },

    onboardingStep: {
        type: Number,
        enum: [1, 2, 3],
        default: 1
    },
    onboardingStatus: {
        type: String,
        enum: ['basic_info', 'documents_uploaded', 'under_review', 'interview_scheduled', 'approved', 'rejected'],
        default: 'basic_info'
    },
    cnicFrontUrl: { type: String, default: '' },
    cnicBackUrl: { type: String, default: '' },
    degreeCertificateUrl: { type: String, default: '' },
    documentsSubmittedAt: { type: Date },
    reviewNotes: { type: String, default: '' },
    adminNotes: { type: String, default: '' },
    rejectionReason: { type: String, default: '' },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    interviewScheduledAt: { type: Date, default: null },
    interviewLink: { type: String, default: '' },

    //  Map Par Plot Karne Ke Liye Location (GeoJSON format)
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [Longitude, Latitude] format
            default: [74.18, 32.16] // Gujranwala ke default coordinates
        }
    }
}, { timestamps: true });

// Geospatial Search (Map Search) ke liye index lagana lazmi hai
tutorSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Tutor', tutorSchema);