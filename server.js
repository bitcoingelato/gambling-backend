require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "casino";

let db, usersCollection, crashCollection, coinflipCollection, rouletteCollection, pokerCollection;

MongoClient.connect(MONGODB_URI, { useUnifiedTopology: true }).then(client => {
    db = client.db(DB_NAME);
    usersCollection = db.collection('users');
    crashCollection = db.collection('crash_rounds');
    coinflipCollection = db.collection('coinflip_games');
    rouletteCollection = db.collection('roulette_games');
    pokerCollection = db.collection('threecp_games');
    console.log("Connected to MongoDB");
}).catch(err => console.error("MongoDB connection error:", err));

// JWT middleware
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
        const { username, email, password } = req.body;
        if (!username || !email || !password) return res.json({ success: false, message: "Missing fields" });
        if (password.length < 6) return res.json({ success: false, message: "Password too short" });
        if (await usersCollection.findOne({ username })) return res.json({ success: false, message: "Username taken" });
        const hash = await bcrypt.hash(password, 10);
        await usersCollection.insertOne({ username, email, password: hash, balance: 1 });
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await usersCollection.findOne({ username });
        if (!user) return res.json({ success: false, message: "User not found" });
        if (!(await bcrypt.compare(password, user.password))) return res.json({ success: false, message: "Wrong password" });
        const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, username: user.username, token });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

app.get('/api/balance', authenticateToken, async (req, res) => {
    const user = await usersCollection.findOne({ username: req.user.username });
    if (!user) return res.json({ success: false });
    res.json({ success: true, balance: user.balance });
});

// ------ CRASH GAME -------
let crashState = {
    roundId: 1,
    status: 'waiting', // 'waiting' | 'running' | 'crashed'
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

app.get('/api/crash/state', (req, res) => {
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
    // Save single bet to bet history
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
    const { amount, color } = req.body; // color: 'red', 'black', 'green'
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

// ------ START ------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Casino server listening on " + PORT));
