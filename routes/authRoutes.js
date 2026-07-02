const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const User = require('../models/User');
const Student = require('../models/Student');
const Tutor = require('../models/Tutor');
const Parent = require('../models/Parent');
const { createWalletOnSignup } = require('../services/walletService');

async function createRoleProfile(role, userId, session) {
    if (role === 'student') {
        await Student.create([{ user: userId }], { session });
    } else if (role === 'tutor') {
        await Tutor.create([{ user: userId }], { session });
    } else if (role === 'parent') {
        await Parent.create([{ user: userId }], { session });
    }
}

// --- 1. Register Route (Called after Firebase Signup Success) ---
router.post('/register', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { firebaseUid, name, email, role, phoneNumber } = req.body;

        const existingUser = await User.findOne({ firebaseUid }).session(session);
        if (existingUser) {
            await session.abortTransaction();
            return res.status(400).json({ message: 'User profile already exists' });
        }

        const [user] = await User.create(
            [{ firebaseUid, name, email, role, phoneNumber }],
            { session }
        );

        await createRoleProfile(role, user._id, session);
        await createWalletOnSignup(user._id, role, session);

        await session.commitTransaction();

        res.status(201).json({
            message: 'User profile created successfully',
            user
        });
    } catch (error) {
        await session.abortTransaction();
        console.error('Registration Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    } finally {
        session.endSession();
    }
});

// --- 2. Login Route (Called after Firebase Login Success) ---
router.post('/login', async (req, res) => {
    try {
        const { email, firebaseUid } = req.body;

        const user = await User.findOne({ firebaseUid });

        if (!user) {
            return res.status(404).json({ message: 'Account profile not found' });
        }

        res.status(200).json({
            message: 'Login Successful!',
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                phoneNumber: user.phoneNumber
            }
        });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

// --- 3. Google Login Route (Kept identical as it matches our structural flow) ---
router.post('/google-login', async (req, res) => {
    try {
        const { name, email, firebaseUid, role } = req.body;
        const existingUser = await User.findOne({ firebaseUid });

        if (existingUser) {
            return res.status(200).json({ message: 'Login successful with Google', user: existingUser });
        }

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const [user] = await User.create(
                [{ name, email, firebaseUid, role, phoneNumber: '' }],
                { session }
            );

            await createRoleProfile(role, user._id, session);
            await createWalletOnSignup(user._id, role, session);

            await session.commitTransaction();

            res.status(201).json({ message: 'Account created via Google', user });
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Google Login Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

// --- 4. Get Profile Details ---
router.get('/profile/:id', async (req, res) => {
    try {
        const userId = req.params.id.trim();
        const user = await User.findById(userId);
        if (!user) { return res.status(404).json({ message: 'User not Found' }); }

        let profileData = null;
        if (user.role === 'student') { profileData = await Student.findOne({ user: userId }); }
        else if (user.role === 'tutor') { profileData = await Tutor.findOne({ user: userId }); }
        else if (user.role === 'parent') { profileData = await Parent.findOne({ user: userId }); }

        res.status(200).json({ user, details: profileData });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

module.exports = router;
