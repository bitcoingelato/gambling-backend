const express = require('express');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json());

// Use environment variable for MongoDB URI, fallback to hardcoded value
const uri = process.env.MONGODB_URI || 'mongodb+srv://bitcoingelato:Yeezy08@cluster0.ufdrrqd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const client = new MongoClient(uri);

async function connectDB() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1); // Exit if MongoDB fails to connect
  }
}

// Ensure DB connection is established before starting the server
connectDB().catch(console.error);

const db = client.db('gamblingDB');
const usersCollection = db.collection('users');

// Root route for homepage
app.get('/', (req, res) => {
  res.send('Welcome to the Gambling Backend!');
});

// Test route to verify the app is running
app.get('/test', (req, res) => {
  res.send('Test route working!');
});

// Signup endpoint
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await usersCollection.insertOne({ username, password: hashedPassword, balance: 0 });
    res.json({ success: true, message: 'User created!' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }
    const user = await usersCollection.findOne({ username });
    if (user && await bcrypt.compare(password, user.password)) {
      res.json({ success: true, message: 'Logged in!' });
    } else {
      res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Start server with dynamic port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));