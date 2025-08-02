const express = require('express');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json());

require('dotenv').config();

const uri = process.env.MONGODB_URI || 'mongodb+srv://bitcoingelato:Yeezy08@cluster0.ufdrrqd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const client = new MongoClient(uri);

async function connectDB() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1);
  }
}

connectDB().catch(console.error);

const db = client.db('gamblingDB');
const usersCollection = db.collection('users');

app.get('/', (req, res) => {
  console.log('Root route hit');
  res.send('Welcome to the Gambling Backend!');
});

app.get('/test', (req, res) => {
  console.log('Test route hit');
  res.send('Test route working!');
});

app.post('/api/signup', async (req, res) => {
  console.log('Signup route hit', req.body);
  try {
    const { username, email, password, captchaToken } = req.body;
    if (!username || !email || !password || !captchaToken) {
      return res.status(400).json({ success: false, message: 'Username, email, password, and CAPTCHA are required' });
    }

    // Check if username or email already exists
    const existingUser = await usersCollection.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      if (existingUser.username === username) {
        return res.status(400).json({ success: false, message: 'Username already taken' });
      }
      if (existingUser.email === email) {
        return res.status(400).json({ success: false, message: 'Email already registered' });
      }
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
    }

    // CAPTCHA validation (simplified; replace with hCaptcha API call in production)
    // For now, assume token is valid; in production, verify with hCaptcha API
    // Example: const captchaResponse = await fetch(`https://hcaptcha.com/siteverify`, { method: 'POST', body: `secret=${process.env.HCAPTCHA_SECRET}&response=${captchaToken}` });
    // if (!captchaResponse.success) return res.status(400).json({ success: false, message: 'Invalid CAPTCHA' });

    const hashedPassword = await bcrypt.hash(password, 10);
    await usersCollection.insertOne({ username, email, password: hashedPassword, balance: 0 });
    res.json({ success: true, message: 'User created successfully!' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  console.log('Login route hit', req.body);
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }
    const user = await usersCollection.findOne({ username });
    if (user && await bcrypt.compare(password, user.password)) {
      res.json({ success: true, message: 'Logged in!', balance: user.balance });
    } else {
      res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/deposit', async (req, res) => {
  console.log('Deposit route hit', req.body);
  try {
    const { username, amount } = req.body;
    if (!username || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Username and positive amount are required' });
    }
    const user = await usersCollection.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    await usersCollection.updateOne(
      { username },
      { $set: { balance: user.balance + amount } }
    );
    res.json({ success: true, message: 'Deposit successful', newBalance: user.balance + amount });
  } catch (err) {
    console.error('Deposit error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/withdraw', async (req, res) => {
  console.log('Withdraw route hit', req.body);
  try {
    const { username, amount } = req.body;
    if (!username || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Username and positive amount are required' });
    }
    const user = await usersCollection.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.balance < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }
    await usersCollection.updateOne(
      { username },
      { $set: { balance: user.balance - amount } }
    );
    res.json({ success: true, message: 'Withdrawal successful', newBalance: user.balance - amount });
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/crash/bet', async (req, res) => {
  console.log('Crash bet route hit', req.body);
  try {
    const { username, betAmount } = req.body;
    if (!username || !betAmount || betAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Username and positive bet amount are required' });
    }
    const user = await usersCollection.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.balance < betAmount) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }
    await usersCollection.updateOne({ username }, { $inc: { balance: -betAmount } });
    res.json({ success: true, message: 'Bet placed', remainingBalance: user.balance - betAmount });
  } catch (err) {
    console.error('Crash bet error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/crash/cashout', async (req, res) => {
  console.log('Crash cashout route hit', req.body);
  try {
    const { username, multiplier } = req.body;
    if (!username || !multiplier || multiplier <= 1) {
      return res.status(400).json({ success: false, message: 'Username and valid multiplier are required' });
    }
    const user = await usersCollection.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const lastBet = 1.0; // Placeholder; replace with actual bet tracking
    const payout = lastBet * multiplier;
    await usersCollection.updateOne({ username }, { $inc: { balance: payout } });
    res.json({ success: true, message: 'Cashout successful', payout, newBalance: user.balance + payout });
  } catch (err) {
    console.error('Crash cashout error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));