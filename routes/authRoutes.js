const express = require('express');
const router = express.Router();

// Models Import
const User = require('../models/User');
const Student = require('../models/Student');
const Tutor = require('../models/Tutor');
const Parent = require('../models/Parent');

// --- 1. Register Route  --- 
router.post('/register', async (req, res) => {
    try {
        const { firebaseUid, name, email, role } = req.body;

        let user = await User.findOne({ firebaseUid });
        if (user) {
            return res.status(400).json({ message: "User already exists" });
        }

        user = new User({ firebaseUid, name, email, role });
        await user.save();

        if (role === 'student') {
            await Student.create({ user: user._id });
        } else if (role === 'tutor') {
            await Tutor.create({ user: user._id });
        } else if (role === 'parent') {
            await Parent.create({ user: user._id });
        }

        res.status(201).json({
            message: "User registered successfully!",
            user
        });

    } catch (error) {
        console.error("Registration Error:", error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});

// --- 2. Login Route  ---
router.post('/login', async (req, res) => {
    try {
        const { email, firebaseUid, role } = req.body;

        const user = await User.findOne({ email, role });

        if (!user) {
            return res.status(404).json({ 
                message: "Account not found." 
            });
        }

        if (user.firebaseUid !== firebaseUid) {
            return res.status(401).json({ message: "Invalid credentials!" });
        }

        res.status(200).json({
            message: "Login Successful!",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) { 
        console.error("Login Error:", error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});

// --- 3. Google Login Route  ---
router.post("/google-login", async (req, res) => {
    try {
        const { name, email, firebaseUid, role } = req.body;

        
        let user = await User.findOne({ firebaseUid });

        if (user) {
           
            return res.status(200).json({ 
                message: "Login successful with Google", 
                user 
            });
        }

        
        user = new User({ 
            name, 
            email, 
            firebaseUid, 
            role, 
            password: null 
        });
        await user.save();

        // Step 3: Role ke mutabiq Profile create karein
        if (role === 'student') {
            await Student.create({ user: user._id });
        } else if (role === 'tutor') {
            await Tutor.create({ user: user._id });
        } else if (role === 'parent') {
            await Parent.create({ user: user._id });
        }

        res.status(201).json({ 
            message: " account created ", 
            user 
        });

    } catch (error) {
        console.error("Google Login Error:", error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});

// --- Get Profile Details ---
router.get('/profile/:id', async (req, res) => {
    try {
        const userId = req.params.id.trim();

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not Found" });
        }

        let profileData = null;

        if (user.role === 'student') {
            profileData = await Student.findOne({ user: userId });
        } else if (user.role === 'tutor') {
            profileData = await Tutor.findOne({ user: userId });
        } else if (user.role === 'parent') {
            profileData = await Parent.findOne({ user: userId });
        }

        res.status(200).json({
            user,
            details: profileData
        });

    } catch (error) {
        console.error("Profile Fetch Error:", error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});

module.exports = router;