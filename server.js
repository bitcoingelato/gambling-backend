const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const cors = require('cors');
dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';
const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 3000;

const client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });

let db, usersCollection, crashRoundsCollection, crashBetsCollection;

async function connectDB() {
  await client.connect();
  db = client.db('gamblingDB');
  usersCollection = db.collection('users');
  crashRoundsCollection = db.collection('crash_rounds');
  crashBetsCollection = db.collection('crash_bets');
  console.log('Connected to MongoDB');
}
connectDB().catch(console.error);

// ---- AUTH MIDDLEWARE ----
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ success: false, message: 'Missing token' });
  const token = header.split(' ')[1];
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ success: false, message: 'Invalid token' });
    req.user = decoded;
    next();
  });
}

// ---- USER AUTH ROUTES ----
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password || !email) return res.status(400).json({ success: false, message: 'Missing fields' });
    const exists = await usersCollection.findOne({ username });
    if (exists) return res.status(400).json({ success: false, message: 'Username taken' });
    const hashed = await bcrypt.hash(password, 10);
    await usersCollection.insertOne({ username, email, password: hashed, balance: 1 }); // Start with 1 BTC (fun mode)
    res.json({ success: true, message: 'User created! Please log in.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Signup error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await usersCollection.findOne({ username });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const token = jwt.sign({ username, id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, username, balance: user.balance });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Login error' });
  }
});

app.get('/api/balance', authMiddleware, async (req, res) => {
  const user = await usersCollection.findOne({ username: req.user.username });
  res.json({ success: true, balance: user?.balance || 0 });
});

// ---- CRASH GAME ENGINE ----
let crashRound = null;
const CRASH_ROUND_DURATION = 10000; // 10 seconds
const CRASH_WAIT_DURATION = 4000;    // 4 seconds between rounds

async function startCrashRound() {
  crashRound = {
    _id: new ObjectId(),
    roundId: Date.now(),
    startTime: Date.now(),
    status: 'running',
    multiplier: 1.0,
    crashPoint: parseFloat((1 + Math.random() * 9).toFixed(2)), // 1.00x - 10.00x
    bets: []
  };
  await crashRoundsCollection.insertOne({ ...crashRound });

  let interval = setInterval(async () => {
    if (!crashRound) return clearInterval(interval);
    crashRound.multiplier += 0.02 + 0.05 * crashRound.multiplier;
    if (crashRound.multiplier >= crashRound.crashPoint) {
      crashRound.status = 'crashed';
      await crashRoundsCollection.updateOne(
        { _id: crashRound._id },
        { $set: { status: 'crashed', multiplier: crashRound.multiplier, endTime: Date.now() } }
      );
      crashRound = null;
      setTimeout(startCrashRound, CRASH_WAIT_DURATION);
      clearInterval(interval);
    }
  }, 300);
}
startCrashRound();

// ---- CRASH GAME ROUTES ----

// Get current crash round state
app.get('/api/crash/state', async (req, res) => {
  let round = crashRound;
  if (!round) {
    round = await crashRoundsCollection.find().sort({ startTime: -1 }).limit(1).next();
  }
  res.json({
    success: true,
    round: round
      ? {
          roundId: round.roundId,
          startTime: round.startTime,
          status: round.status,
          multiplier: round.multiplier,
          crashPoint: round.crashPoint,
        }
      : null
  });
});

// Place a bet in the current crash round
app.post('/api/crash/bet', authMiddleware, async (req, res) => {
  try {
    if (!crashRound || crashRound.status !== 'running') return res.status(400).json({ success: false, message: 'No running round' });
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });
    const user = await usersCollection.findOne({ username: req.user.username });
    if (!user || user.balance < amount) return res.status(400).json({ success: false, message: 'Insufficient balance' });

    // Check if already placed a bet this round
    const alreadyBet = await crashBetsCollection.findOne({ roundId: crashRound.roundId, username: req.user.username, cashedOut: false });
    if (alreadyBet) return res.status(400).json({ success: false, message: 'You already placed a bet this round' });

    await usersCollection.updateOne({ username: req.user.username }, { $inc: { balance: -amount } });
    await crashBetsCollection.insertOne({
      roundId: crashRound.roundId,
      username: req.user.username,
      amount,
      cashedOut: false,
      placedAt: Date.now()
    });
    crashRound.bets.push({ username: req.user.username, amount });
    res.json({ success: true, message: 'Bet placed' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Bet error' });
  }
});

// Cash out of the current crash round
app.post('/api/crash/cashout', authMiddleware, async (req, res) => {
  try {
    if (!crashRound || crashRound.status !== 'running') return res.status(400).json({ success: false, message: 'No running round' });
    const bet = await crashBetsCollection.findOne({
      roundId: crashRound.roundId,
      username: req.user.username,
      cashedOut: false
    });
    if (!bet) return res.status(400).json({ success: false, message: 'No active bet to cash out' });

    const payout = parseFloat((bet.amount * crashRound.multiplier).toFixed(8));
    await usersCollection.updateOne({ username: req.user.username }, { $inc: { balance: payout } });
    await crashBetsCollection.updateOne(
      { roundId: crashRound.roundId, username: req.user.username },
      { $set: { cashedOut: true, cashoutMultiplier: crashRound.multiplier, cashoutAt: Date.now(), payout } }
    );
    res.json({ success: true, payout, multiplier: crashRound.multiplier });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Cashout error' });
  }
});

// Get user's crash bet history (optional)
app.get('/api/crash/history', authMiddleware, async (req, res) => {
  const bets = await crashBetsCollection.find({ username: req.user.username }).sort({ placedAt: -1 }).limit(50).toArray();
  res.json({ success: true, bets });
});

// ---- LAUNCH SERVER ----
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
