const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const User = require('../models/User');
const Student = require('../models/Student');
const Tutor = require('../models/Tutor');
const Parent = require('../models/Parent');
const { createWalletOnSignup } = require('../services/walletService');
const verifyFirebaseToken = require('../middleware/verifyFirebaseToken');

const PUBLIC_ROLES = new Set(['student', 'tutor', 'parent']);

function validatePublicRole(role) {
    if (!PUBLIC_ROLES.has(role)) {
        return false;
    }
    return true;
}

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
router.post('/register', verifyFirebaseToken, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Body fields still accepted; identity comes from verified token only
        const { name, role, phoneNumber } = req.body;
        const firebaseUid = req.firebase.uid;
        const email = req.firebase.email;

        if (!email) {
            await session.abortTransaction();
            return res.status(400).json({ message: 'Email is required on the Firebase account' });
        }

        if (!validatePublicRole(role)) {
            await session.abortTransaction();
            return res.status(400).json({ message: 'Invalid role. Allowed roles: student, tutor, parent' });
        }

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
        res.status(500).json({ message: 'Server Error' });
    } finally {
        session.endSession();
    }
});

// --- 2. Login Route (Called after Firebase Login Success) ---
router.post('/login', verifyFirebaseToken, async (req, res) => {
    try {
        // Body may still include email/firebaseUid; identity from token only
        const firebaseUid = req.firebase.uid;

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
        res.status(500).json({ message: 'Server Error' });
    }
});

// --- 3. Google Login Route ---
router.post('/google-login', verifyFirebaseToken, async (req, res) => {
    try {
        // Body may still include firebaseUid/email; identity from token only
        const { name, role } = req.body;
        const firebaseUid = req.firebase.uid;
        const email = req.firebase.email;


        const existingUser = await User.findOne({ firebaseUid });

        if (existingUser) {
            return res.status(200).json({ message: 'Login successful with Google', user: existingUser });
        }

        if (!email) {
            return res.status(400).json({ message: 'Email is required on the Firebase account' });
        }

        if (!validatePublicRole(role)) {
            return res.status(400).json({ message: 'Invalid role. Allowed roles: student, tutor, parent' });
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
        res.status(500).json({ message: 'Server Error' });
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
