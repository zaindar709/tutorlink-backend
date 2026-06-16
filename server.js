const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors'); 
const admin = require('firebase-admin'); 
// dotenv ko top par load karna zaroori hai taake process.env pehle chal jaye
require('dotenv').config(); 

// SMART FIREBASE CONFIG: Local computer par file uthaye ga, Render par Env Variable!
let serviceAccount;
if (process.env.FIREBASE_CONFIG_JSON) {
  serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);
} else {
  serviceAccount = require('./firebase-config.json');
}

const app = express();

// 2. CORS Setup 
app.use(cors()); 

// 3. Firebase Admin Setup 
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
}); 
console.log("🔥 Firebase Admin Initialized!");

// 4. Body Parser (JSON data handle karne ke liye)
app.use(express.json());

// Routes Registration
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/tutors', require('./routes/tutorRoutes'));

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