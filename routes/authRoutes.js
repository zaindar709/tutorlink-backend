const express = require('express');
const router = express.Router();

// Models Import
const User = require('../models/User');
const Student = require('../models/Student');
const Tutor = require('../models/Tutor');
const Parent = require('../models/Parent');

// --- 1. Register Route (Called after Firebase Signup Success) --- 
router.post('/register', async (req, res) => {
    try {
        const { firebaseUid, name, email, role, phoneNumber } = req.body;

        // Check if user already exists in MongoDB via firebaseUid
        let user = await User.findOne({ firebaseUid });
        if (user) {
            return res.status(400).json({ message: "User profile already exists" });
        }

        // Save profile directly (No password field stored here)
        user = new User({ 
            firebaseUid, 
            name,  
            email, 
            role, 
            phoneNumber 
        });
        await user.save(); 

        // Create role-specific sub-profiles
        if (role === 'student') {
            await Student.create({ user: user._id });
        } else if (role === 'tutor') {
            await Tutor.create({ user: user._id });
        } else if (role === 'parent') {
            await Parent.create({ user: user._id });
        }

        res.status(201).json({
            message: "User profile created successfully",
            user
        });

    } catch (error) {
        console.error("Registration Error:", error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});

// --- 2. Login Route (Called after Firebase Login Success) ---
router.post('/login', async (req, res) => {
    try {
        const { email, firebaseUid } = req.body;
        
        // Find user by Firebase UID
        const user = await User.findOne({ firebaseUid });

        if (!user) {
            return res.status(404).json({ message: "Account profile not found" });
        }

        res.status(200).json({
            message: "Login Successful!",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                phoneNumber: user.phoneNumber
            }
        });
    } catch (error) { 
        console.error("Login Error:", error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});

// --- 3. Google Login Route (Kept identical as it matches our structural flow) ---
router.post("/google-login", async (req, res) => {
    try {
        const { name, email, firebaseUid, role } = req.body;
        let user = await User.findOne({ firebaseUid });

        if (user) {
            return res.status(200).json({ message: "Login successful with Google", user });
        }

        user = new User({ name, email, firebaseUid, role, phoneNumber: "" });
        await user.save();

        if (role === 'student') { await Student.create({ user: user._id }); }
        else if (role === 'tutor') { await Tutor.create({ user: user._id }); }
        else if (role === 'parent') { await Parent.create({ user: user._id }); }

        res.status(201).json({ message: "Account created via Google", user });
    } catch (error) {
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});

// --- 4. Get Profile Details ---
router.get('/profile/:id', async (req, res) => {
    try {
        const userId = req.params.id.trim();
        const user = await User.findById(userId);
        if (!user) { return res.status(404).json({ message: "User not Found" }); }

        let profileData = null;
        if (user.role === 'student') { profileData = await Student.findOne({ user: userId }); }
        else if (user.role === 'tutor') { profileData = await Tutor.findOne({ user: userId }); }
        else if (user.role === 'parent') { profileData = await Parent.findOne({ user: userId }); }

        res.status(200).json({ user, details: profileData });
    } catch (error) {
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});

module.exports = router;