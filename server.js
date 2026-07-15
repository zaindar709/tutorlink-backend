const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const admin = require('firebase-admin');// dotenv ko top par load karna zaroori hai taake process.env pehle chal jaye
require('dotenv').config(); 

// SMART FIREBASE CONFIG: Local computer par file uthaye ga, Render par Env Variable!
let serviceAccount;
if (process.env.FIREBASE_CONFIG_JSON) {
  serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);
} else {
  serviceAccount = require('./firebase-config.json');
}

const app = express();

// Security headers (Helmet) — applied before routes; CORP cross-origin keeps /uploads usable from clients
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

// 2. CORS Setup 
app.use(cors()); 

// 3. Firebase Admin Setup 
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
}); 
console.log("🔥 Firebase Admin Initialized!");

// 4. Body Parser (JSON data handle karne ke liye)
app.use(express.json());

// Uploaded tutor documents (local disk; replace with cloud storage in production)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Routes Registration
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/tutors', require('./routes/tutorRoutes'));
app.use('/api/tutor/onboarding', require('./routes/tutorOnboardingRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/bookings', require('./routes/bookingRoutes'));
app.use('/api/wallet', require('./routes/walletRoutes'));
app.use('/api/billing', require('./routes/billingRoutes'));
app.use('/api/profile', require('./routes/profileRoutes'));
app.use('/api/home', require('./routes/homeRoutes'));

// Database Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Database Connected: TutorLink Online!"))
  .catch((err) => {
      console.log("❌ Connection Error Detail:", err.message);
  });

app.get('/', (req, res) => {
  res.send("TutorLink Server is Running!");
});

// Dynamic Port Setup for Render
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});