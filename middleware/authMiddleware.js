const admin = require('firebase-admin');
const User = require('../models/User');
const Student = require('../models/Student');
const Tutor = require('../models/Tutor');
const Parent = require('../models/Parent');

const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Unauthorized: No token provided' });
        }

        const token = authHeader.split('Bearer ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Unauthorized: Invalid token format' });
        }

        const decodedToken = await admin.auth().verifyIdToken(token);

        const user = await User.findOne({ firebaseUid: decodedToken.uid });
        if (!user) {
            return res.status(401).json({ message: 'Unauthorized: User profile not found' });
        }

        let profile = null;
        if (user.role === 'student') {
            profile = await Student.findOne({ user: user._id });
        } else if (user.role === 'tutor') {
            profile = await Tutor.findOne({ user: user._id });
        } else if (user.role === 'parent') {
            profile = await Parent.findOne({ user: user._id });
        }

        req.firebase = decodedToken;
        req.user = user;
        req.profile = profile;

        next();
    } catch (error) {
        console.error('Auth Middleware Error:', error.message);
        return res.status(401).json({ message: 'Unauthorized: Invalid or expired token' });
    }
};

module.exports = authMiddleware;
