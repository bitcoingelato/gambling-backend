const express = require('express');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');
const fetch = require('node-fetch');
const WebSocket = require('ws');

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

// WebSocket setup
const server = app.listen(process.env.PORT || 3000, () => console.log(`Server running on port ${process.env.PORT || 3000}`));
const wss = new WebSocket.Server({ server });

let currentRound = {
  multiplier: 1.0,
  active: false,
  crashPoint: null,
  players: new Map(), // Map of username to bet amount
  timer: null
};

function startNewRound() {
  if (currentRound.timer) clearInterval(currentRound.timer);
  currentRound = {
    multiplier: 1.0,
    active: true,
    crashPoint: null,
    players: new Map(),
    timer: setInterval(() => {
      currentRound.multiplier += 0.1;
      broadcastState();
      if (Math.random() < 0.1) { // 10% chance to crash
        endRound();
      }
    }, 100)
  };
  broadcastState();
}

function endRound() {
  if (currentRound.timer) clearInterval(currentRound.timer);
  currentRound.active = false;
  currentRound.crashPoint = currentRound.multiplier;
  currentRound.players.forEach((betAmount, username) => {
    const payout = betAmount * currentRound.crashPoint;
    usersCollection.updateOne({ username }, { $inc: { balance: payout } });
  });
  broadcastState();
  setTimeout(startNewRound, 5000); // 5-second break before next round
}

function broadcastState() {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        multiplier: currentRound.multiplier.toFixed(2),
        active: currentRound.active,
        crashPoint: currentRound.crashPoint,
        timeLeft: currentRound.timer ? 9 - Math.floor((Date.now() - currentRound.startTime) / 1000) : 5
      }));
    }
  });
}

wss.on('connection', ws => {
  ws.on('message', async message => {
    const data = JSON.parse(message);
    if (data.type === 'join' && currentUser) {
      ws.send(JSON.stringify({ success: true, message: 'Joined round' }));
      broadcastState();
    } else if (data.type === 'bet' && data.username && data.betAmount) {
      const user = await usersCollection.findOne({ username: data.username });
      if (user && user.balance >= data.betAmount && currentRound.active) {
        currentRound.players.set(data.username, data.betAmount);
        usersCollection.updateOne({ username: data.username }, { $inc: { balance: -data.betAmount } });
        ws.send(JSON.stringify({ success: true, remainingBalance: user.balance - data.betAmount }));
        broadcastState();
      } else {
        ws.send(JSON.stringify({ success: false, message: 'Invalid bet' }));
      }
    } else if (data.type === 'cashout' && data.username && data.multiplier) {
      if (currentRound.players.has(data.username) && currentRound.active) {
        const betAmount = currentRound.players.get(data.username);
        const payout = betAmount * data.multiplier;
        currentRound.players.delete(data.username);
        usersCollection.updateOne({ username: data.username }, { $inc: { balance: payout } });
        ws.send(JSON.stringify({ success: true, payout, newBalance: (await usersCollection.findOne({ username: data.username })).balance }));
        broadcastState();
      } else {
        ws.send(JSON.stringify({ success: false, message: 'Invalid cashout' }));
      }
    }
  });
});

app.get('/', (req, res) => {
  console.log('Root route hit');
  res.send('Welcome to the Bitcoin Gelato Backend!');
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
      return res.status(400).json({ success: false, message: 'All fields (username, email, password, CAPTCHA) are required' });
    }

    const existingUser = await usersCollection.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      if (existingUser.username === username) return res.status(400).json({ success: false, message: 'Username already taken' });
      if (existingUser.email === email) return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
    }

    const captchaResponse = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=b1e64024-155e-43da-a5e6-9b56729c337e&response=${captchaToken}`
    }).then(res => res.json());
    if (!captchaResponse.success) return res.status(400).json({ success: false, message: 'Invalid CAPTCHA' });

    const hashedPassword = await bcrypt.hash(password, 10);
    await usersCollection.insertOne({ username, email, password: hashedPassword, balance: 0 });
    res.json({ success: true, message: 'Account created successfully! Please log in.' });
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
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await usersCollection.updateOne({ username }, { $set: { balance: user.balance + amount } });
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
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.balance < amount) return res.status(400).json({ success: false, message: 'Insufficient balance' });
    await usersCollection.updateOne({ username }, { $set: { balance: user.balance - amount } });
    res.json({ success: true, message: 'Withdrawal successful', newBalance: user.balance - amount });
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});