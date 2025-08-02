const express = require('express');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');
const btcpay = require('btcpay');

const app = express();
app.use(express.json());

require('dotenv').config(); // Load .env file

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

    // Initialize BTCPay client
    const keypair = btcpay.crypto.generate_keypair();
    const privateKey = keypair.priv;
    const client = new btcpay.BTCPayClient(process.env.BTCPAY_URL, keypair, { merchant: process.env.BTCPAY_STORE_ID });

    // Pair the client (one-time setup)
    const pairingCode = 'your-pairing-code-from-btcpay'; // Replace with actual pairing code
    await client.pair_client(pairingCode);

    // Create BTCPay invoice
    const invoice = await client.create_invoice({
      price: amount,
      currency: 'USD',
      itemDesc: `Deposit for ${username}`,
      notificationURL: `${process.env.HEROKU_URL}/api/webhook`, // Webhook URL
      redirectURL: `${process.env.HEROKU_URL}/success`, // Optional redirect after payment
    });

    res.json({
      success: true,
      message: 'Invoice created',
      checkoutLink: invoice.url,
      invoiceId: invoice.id,
    });
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

// Webhook to handle BTCPay payment confirmation
app.post('/api/webhook', (req, res) => {
  console.log('Webhook hit', req.body);
  const { id, status } = req.body;
  if (status === 'confirmed' || status === 'complete') {
    // Update user balance (simplified; in practice, match invoice to user)
    usersCollection.updateOne(
      { username: 'testuser5' }, // Replace with logic to match invoice to user
      { $inc: { balance: 1.5 } } // Replace with actual amount from invoice
    ).catch(err => console.error('Webhook update error:', err));
  }
  res.sendStatus(200); // Acknowledge webhook
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));