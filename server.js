require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();

// ---- CORS ----
const allowedOrigins = [
  'https://reliable-cendol-97b021.netlify.app',
  'http://localhost:8888',
  'http://localhost:3000',
];
app.use(cors({
  origin: function(origin, callback){
    if(!origin) return callback(null, true);
    if(allowedOrigins.indexOf(origin) === -1){
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "casino";
const HCAPTCHA_SECRET = process.env.HCAPTCHA_SECRET || "b1e64024-155e-43da-a5e6-9b56729c337e";

let db, usersCollection, crashCollection, coinflipCollection, rouletteCollection, pokerCollection;
let dbReady = false;
MongoClient.connect(MONGODB_URI, { useUnifiedTopology: true }).then(client => {
    db = client.db(DB_NAME);
    usersCollection = db.collection('users');
    crashCollection = db.collection('crash_rounds');
    coinflipCollection = db.collection('coinflip_games');
    rouletteCollection = db.collection('roulette_games');
    pokerCollection = db.collection('threecp_games');
    dbReady = true;
    console.log("Connected to MongoDB");
}).catch(err => {
    dbReady = false;
    console.error("MongoDB connection error:", err);
});

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});
app.use((req, res, next) => {
    if (!dbReady) return res.status(503).json({ success: false, message: "Database not connected." });
    next();
});

function authenticateToken(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth) return res.status(401).json({ success: false, message: "No token" });
    const token = auth.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: "Invalid token" });
        req.user = user;
        next();
    });
}

// ------ AUTH ------
app.post('/api/signup', async (req, res) => {
    try {
        const { username, email, password, captchaToken } = req.body;
        if (!username || !email || !password || !captchaToken) {
            return res.json({ success: false, message: "Missing fields" });
        }
        if (password.length < 6) return res.json({ success: false, message: "Password too short" });
        if (await usersCollection.findOne({ username })) return res.json({ success: false, message: "Username taken" });
        if (await usersCollection.findOne({ email })) return res.json({ success: false, message: "Email taken" });

        // hCaptcha verification (server-side)
        const captchaResponse = await fetch('https://hcaptcha.com/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${HCAPTCHA_SECRET}&response=${captchaToken}`
        }).then(r => r.json());
        if (!captchaResponse.success) return res.json({ success: false, message: "Invalid CAPTCHA" });

        // Give every new user a balance of 100 (fun mode!)
        const hash = await bcrypt.hash(password, 10);
        await usersCollection.insertOne({
            username,
            email,
            password: hash,
            balance: 100,
            emailVerified: false,
            created: new Date()
        });
        // Optionally create email verification token here, but skip sending for now
        res.json({ success: true });
    } catch (e) {
        console.error("Signup error:", e);
        res.json({ success: false, message: e.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password, captchaToken } = req.body;
        if (!username || !password || !captchaToken) {
            return res.json({ success: false, message: "Missing fields" });
        }
        // hCaptcha verification (server-side)
        const captchaResponse = await fetch('https://hcaptcha.com/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${HCAPTCHA_SECRET}&response=${captchaToken}`
        }).then(r => r.json());
        if (!captchaResponse.success) return res.json({ success: false, message: "Invalid CAPTCHA" });

        const user = await usersCollection.findOne({ username });
        if (!user) return res.json({ success: false, message: "User not found" });
        if (!(await bcrypt.compare(password, user.password))) return res.json({ success: false, message: "Wrong password" });
        const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, username: user.username, token });
    } catch (e) {
        console.error("Login error:", e);
        res.json({ success: false, message: e.message });
    }
});

app.get('/api/balance', authenticateToken, async (req, res) => {
    const user = await usersCollection.findOne({ username: req.user.username });
    if (!user) return res.json({ success: false });
    res.json({ success: true, balance: user.balance });
});

// ------ ACCOUNT SETTINGS ------
app.post('/api/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.json({ success: false, message: "All fields required." });
        if (newPassword.length < 6) return res.json({ success: false, message: "New password too short." });
        const user = await usersCollection.findOne({ username: req.user.username });
        if (!user) return res.json({ success: false, message: "User not found." });
        if (!(await bcrypt.compare(currentPassword, user.password))) return res.json({ success: false, message: "Current password incorrect." });
        const hash = await bcrypt.hash(newPassword, 10);
        await usersCollection.updateOne({ username: req.user.username }, { $set: { password: hash } });
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

app.post('/api/change-email', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newEmail } = req.body;
        if (!currentPassword || !newEmail) return res.json({ success: false, message: "All fields required." });
        const user = await usersCollection.findOne({ username: req.user.username });
        if (!user) return res.json({ success: false, message: "User not found." });
        if (!(await bcrypt.compare(currentPassword, user.password))) return res.json({ success: false, message: "Current password incorrect." });
        if (await usersCollection.findOne({ email: newEmail })) return res.json({ success: false, message: "Email already in use." });
        await usersCollection.updateOne({ username: req.user.username }, { $set: { email: newEmail, emailVerified: false } });
        // Optionally: trigger sending new verification email here
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// ------ CRASH GAME -------
let crashState = {
    roundId: 1,
    status: 'waiting',
    multiplier: 1,
    bets: {},
    crashAt: 2
};

function startCrashRound() {
    crashState.roundId += 1;
    crashState.status = 'running';
    crashState.multiplier = 1;
    crashState.bets = {};
    crashState.crashAt = 1 + Math.pow(Math.random(), 2) * 4;
    crashCollection.insertOne({
        roundId: crashState.roundId,
        crashAt: crashState.crashAt,
        bets: [],
        created: new Date()
    });
    let interval = setInterval(async () => {
        crashState.multiplier += 0.01 + crashState.multiplier * 0.02;
        if (crashState.multiplier >= crashState.crashAt) {
            crashState.status = 'crashed';
            await crashCollection.updateOne(
                { roundId: crashState.roundId },
                { $set: { crashAt: crashState.crashAt, ended: new Date(), bets: Object.values(crashState.bets) } }
            );
            setTimeout(startCrashRound, 4000);
            clearInterval(interval);
        }
    }, 100);
}
setTimeout(startCrashRound, 2000);

app.get('/api/crash/state', authenticateToken, (req, res) => {
    res.json({ success: true, round: { ...crashState, bets: undefined } });
});
app.post('/api/crash/bet', authenticateToken, async (req, res) => {
    const user = await usersCollection.findOne({ username: req.user.username });
    if (!user) return res.json({ success: false, message: "User not found" });
    if (crashState.status !== 'running') return res.json({ success: false, message: "No round running" });
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) return res.json({ success: false, message: "Invalid amount" });
    if (user.balance < amount) return res.json({ success: false, message: "Insufficient balance" });
    if (crashState.bets[user.username]) return res.json({ success: false, message: "Already bet" });
    await usersCollection.updateOne({ username: user.username }, { $inc: { balance: -amount } });
    crashState.bets[user.username] = { username: user.username, amount, at: crashState.multiplier, cashedOut: false };
    res.json({ success: true });
});
app.post('/api/crash/cashout', authenticateToken, async (req, res) => {
    const user = await usersCollection.findOne({ username: req.user.username });
    if (!user) return res.json({ success: false, message: "User not found" });
    const bet = crashState.bets[user.username];
    if (!bet || bet.cashedOut) return res.json({ success: false, message: "No bet" });
    if (crashState.status !== 'running') return res.json({ success: false, message: "Not running" });
    bet.cashedOut = true;
    bet.cashedAt = crashState.multiplier;
    const payout = parseFloat((bet.amount * crashState.multiplier).toFixed(8));
    await usersCollection.updateOne({ username: user.username }, { $inc: { balance: payout } });
    await crashCollection.updateOne(
        { roundId: crashState.roundId },
        { $push: { bets: { username: user.username, amount: bet.amount, cashedAt: crashState.multiplier, payout, cashedOut: true, time: new Date() } } }
    );
    res.json({ success: true, payout, multiplier: crashState.multiplier });
});

// ------ COINFLIP -------
app.post('/api/coinflip/bet', authenticateToken, async (req, res) => {
    const { amount, choice } = req.body;
    if (!amount || amount <= 0 || !["heads", "tails"].includes(choice)) return res.json({ success: false, message: "Invalid bet." });
    const user = await usersCollection.findOne({ username: req.user.username });
    if (!user) return res.json({ success: false, message: "User not found." });
    if (user.balance < amount) return res.json({ success: false, message: "Insufficient balance." });
    const result = Math.random() < 0.5 ? "heads" : "tails";
    const win = (choice === result);
    let payout = win ? amount : 0;
    await usersCollection.updateOne({ username: user.username }, { $inc: { balance: payout - amount } });
    await coinflipCollection.insertOne({ username: user.username, amount, choice, result, win, payout, created: new Date() });
    res.json({ success: true, result, win, payout });
});

// ------ ROULETTE -------
const rouletteColors = Array(15).fill("black").concat(Array(15).fill("red")).concat(["green"]);
app.post('/api/roulette/bet', authenticateToken, async (req, res) => {
    const { amount, color } = req.body;
    if (!amount || amount <= 0 || !["red", "black", "green"].includes(color)) return res.json({ success: false, message: "Invalid bet." });
    const user = await usersCollection.findOne({ username: req.user.username });
    if (!user) return res.json({ success: false, message: "User not found." });
    if (user.balance < amount) return res.json({ success: false, message: "Insufficient balance." });
    await usersCollection.updateOne({ username: user.username }, { $inc: { balance: -amount } });
    const spin = Math.floor(Math.random() * rouletteColors.length);
    const result = rouletteColors[spin];
    let payout = 0;
    if (color === result) payout = color === "green" ? amount * 14 : amount * 2;
    await usersCollection.updateOne({ username: user.username }, { $inc: { balance: payout } });
    await rouletteCollection.insertOne({ username: user.username, amount, color, result, payout, created: new Date() });
    res.json({ success: true, result, payout });
});

// ------ 3 Card Poker -------
const deck = () => {
    const suits = ['H','D','C','S'];
    const ranks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
    let d = [];
    for (let s of suits) for (let r of ranks) d.push(r+s);
    return d;
};
function drawHand(d) { for (let i=0,h=[];i<3;i++) h.push(d.splice(Math.floor(Math.random()*d.length),1)[0]); return h; }

app.post('/api/3cp/bet', authenticateToken, async (req, res) => {
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) return res.json({ success: false, message: "Invalid bet." });
    const user = await usersCollection.findOne({ username: req.user.username });
    if (!user) return res.json({ success: false, message: "User not found." });
    if (user.balance < amount) return res.json({ success: false, message: "Insufficient balance." });
    await usersCollection.updateOne({ username: user.username }, { $inc: { balance: -amount } });
    let d = deck();
    const player = drawHand(d), dealer = drawHand(d);
    const playerValue = Math.max(...player.map(c => "23456789TJQKA".indexOf(c[0])));
    const dealerValue = Math.max(...dealer.map(c => "23456789TJQKA".indexOf(c[0])));
    let win = playerValue > dealerValue;
    let payout = win ? amount * 2 : 0;
    if (win) await usersCollection.updateOne({ username: user.username }, { $inc: { balance: payout } });
    await pokerCollection.insertOne({ username: user.username, amount, player, dealer, win, payout, created: new Date() });
    res.json({ success: true, player, dealer, win, payout });
});

// ------ BET HISTORY ------
app.get('/api/history/:game', authenticateToken, async (req, res) => {
    const { game } = req.params;
    let collection;
    if (game === "crash") collection = crashCollection;
    else if (game === "coinflip") collection = coinflipCollection;
    else if (game === "roulette") collection = rouletteCollection;
    else if (game === "3cp") collection = pokerCollection;
    else return res.json({ success: false, message: "Unknown game" });

    let query, project;
    if (game === "crash") {
        query = { "bets.username": req.user.username };
        project = { roundId: 1, crashAt: 1, bets: 1, created: 1, ended: 1 };
    } else {
        query = { username: req.user.username };
        project = { _id: 0 };
    }

    let results = await collection.find(query, { projection: project }).sort({ created: -1, roundId: -1 }).limit(20).toArray();
    res.json({ success: true, history: results });
});

// ------ CHATBOX API ------

// Get latest 50 messages (newest last)
app.get('/api/chat', async (req, res) => {
    try {
        const messages = await db.collection('chat_messages')
            .find({})
            .sort({ timestamp: -1 })
            .limit(50)
            .toArray();
        res.json({ success: true, messages: messages.reverse() });
    } catch (e) {
        res.json({ success: false, message: 'Error fetching chat.' });
    }
});

// Post a new chat message (requires login)
app.post('/api/chat', authenticateToken, async (req, res) => {
    try {
        const username = req.user?.username;
        if (!username) return res.status(401).json({ success: false, message: "Not logged in." });
        const { message } = req.body;
        if (!message || typeof message !== "string" || !message.trim()) {
            return res.status(400).json({ success: false, message: "Message cannot be empty." });
        }
        const cleanMsg = message.slice(0, 300);
        await db.collection('chat_messages').insertOne({
            username,
            message: cleanMsg,
            timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: 'Error posting chat.' });
    }
});

// ------ START ------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Casino server listening on " + PORT));
