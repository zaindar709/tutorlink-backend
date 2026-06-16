const express = require('express');
const router = express.Router();
const Tutor = require('../models/Tutor');

//  TUTOR ADVANCED SEARCH & FILTER API
router.post('/search', async (req, res) => {
    try {
        const {
            subject,
            grade,
            teachingMode,
            minFee,
            maxFee,
            minRating,
            experience,
            gender,
            availability,
            isVerified,
            //  Map Location parameters
            studentLat,
            studentLng,
            radiusInKm = 10 // Default radius 10 kilometer hai
        } = req.body;

        // Dynamic query object
        let query = {};

        // 1. Basic Filters Apply Karna
        if (subject) query.subjects = { $in: [subject] };
        if (grade) query.grades = { $in: [grade] };
        if (teachingMode) query.teachingMode = teachingMode;
        if (gender) query.gender = gender;
        if (availability !== undefined) query.availability = availability;
        if (isVerified !== undefined) query.isVerified = isVerified;
        
        // 2. Range Filters (Fee, Rating, Experience)
        if (minFee || maxFee) {
            query.hourlyRate = {}; // Aapke model ke mutabiq hourlyRate use kiya hai
            if (minFee) query.hourlyRate.$gte = Number(minFee);
            if (maxFee) query.hourlyRate.$lte = Number(maxFee);
        }

        if (minRating) query.rating = { $gte: Number(minRating) };
        if (experience) query.experienceYears = { $gte: Number(experience) };

        // 3.  Geospatial Filter (Map Par Nearby Tutors Dhoondna)
        if (studentLat && studentLng) {
            query.location = {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [parseFloat(studentLng), parseFloat(studentLat)] // [Longitude, Latitude]
                    },
                    $maxDistance: radiusInKm * 1000 // Meters mein conversion
                }
            };
        }

        // Database se filter shuda tutors fetch karna
        const tutors = await Tutor.find(query).populate('user', 'name email'); // User model se naam aur email link karne ke liye

        res.status(200).json({
            success: true,
            results: tutors.length,
            data: tutors
        });

    } catch (error) {
        res.status(500).json({ success: false, message: "Search Error", error: error.message });
    }
});

module.exports = router;