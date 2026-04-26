const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors'); 
const admin = require('firebase-admin'); 
const serviceAccount = require('./firebase-config.json'); 
require('dotenv').config();

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

// Auth Routes
app.use('/api/auth', require('./routes/authRoutes'));

// Database Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Database Connected: TutorLink Online!"))
  .catch((err) => {
      console.log("❌ Connection Error Detail:", err.message);
  });

app.get('/', (req, res) => {
  res.send("TutorLink Server is Running!");
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server started on http://localhost:${PORT}`);
});