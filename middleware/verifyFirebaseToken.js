const admin = require('firebase-admin');

/**
 * Thin Firebase ID token verification.
 * Verifies the Bearer token only — does not require a MongoDB User.
 * Attaches the decoded token as req.firebase (uid, email, etc.).
 */
const verifyFirebaseToken = async (req, res, next) => {
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

        req.firebase = decodedToken;
        next();
    } catch (error) {
        console.error('Verify Firebase Token Error:', error.message);
        return res.status(401).json({ message: 'Unauthorized: Invalid or expired token' });
    }
};

module.exports = verifyFirebaseToken;
