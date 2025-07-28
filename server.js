const express = require('express');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json());

const uri = 'mongodb+srv://bitcoingelato:Yeezy08@cluster0.ufdrrqd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0'; // Paste your connection string here
const client = new MongoClient(uri);

async function connectDB() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('Error connecting to MongoDB:', err);
  }
}
connectDB();

const db = client.db('gamblingDB');
const usersCollection = db.collection('users');

// Signup endpoint
app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  await usersCollection.insertOne({ username, password: hashedPassword, balance: 0 });
  res.json({ success: true, message: 'User created!' });
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await usersCollection.findOne({ username });
  if (user && await bcrypt.compare(password, user.password)) {
    res.json({ success: true, message: 'Logged in!' });
  } else {
    res.json({ success: false, message: 'Invalid username or password' });
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));