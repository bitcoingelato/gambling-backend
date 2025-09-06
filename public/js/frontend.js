// ======= CONFIG =======
const API = window.location.hostname === 'localhost' ? 
  "http://localhost:3000/api" : 
  "https://desolate-shore-72677-e0fe07c2f233.herokuapp.com/api";
// ======================

let authToken = '';
let user = '';
let crashPoll = null;
let placedBet = null;
let crashRoundId = 0;
let coinflipChoice = null;
let countdownInterval = null;
let crashSeeds = {}; // Store server seed hash for verification
let crashGameState = 'waiting'; // 'waiting', 'running', 'crashed'
let crashAnimationInterval = null;
let lastCrashMultipliers = []; // Store last crash multipliers
let currentCrashMultiplier = 1.00;
let userBalance = 0; // Track user balance

// Debug log function
function log(msg) {
  console.log(msg);
  const debugPanel = document.getElementById('debug-panel');
  if (debugPanel) {
    const time = new Date().toLocaleTimeString();
    debugPanel.innerHTML += `<div>[${time}] ${msg}</div>`;
    debugPanel.scrollTop = debugPanel.scrollHeight;
  }
}

// ---------- INITIALIZATION ----------
document.addEventListener('DOMContentLoaded', function() {
  log("DOM loaded, initializing...");
  
  // Check for existing session
  checkSession();
  
  // Set up event listeners
  setupEventListeners();
});

function setupEventListeners() {
  // Auth section
  document.getElementById('showSignup').addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('loginBox').classList.add('hidden');
    document.getElementById('signupBox').classList.remove('hidden');
  });
  
  document.getElementById('showLogin').addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('loginBox').classList.remove('hidden');
    document.getElementById('signupBox').classList.add('hidden');
  });
  
  document.getElementById('loginBtn').addEventListener('click', login);
  document.getElementById('signupBtn').addEventListener('click', signup);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  
  // Game sections
  document.getElementById('btnCrash').addEventListener('click', showCrashSection);
  document.getElementById('btnCoinflip').addEventListener('click', showCoinflipSection);
  document.getElementById('btnRoulette').addEventListener('click', showRouletteSection);
  document.getElementById('btn3cp').addEventListener('click', show3CPSection);
  document.getElementById('btnSettings').addEventListener('click', showSettingsSection);
  
  // Back buttons
  document.getElementById('backFromCrash').addEventListener('click', backToMenu);
  document.getElementById('backFromCoinflip').addEventListener('click', backToMenu);
  document.getElementById('backFromRoulette').addEventListener('click', backToMenu);
  document.getElementById('backFrom3CP').addEventListener('click', backToMenu);
  document.getElementById('backFromSettings').addEventListener('click', backToMenu);
  
  // Crash game
  document.getElementById('crashBetBtn').addEventListener('click', placeCrashBet);
  document.getElementById('crashCancelBtn').addEventListener('click', cancelCrashBet);
  document.getElementById('crashCashoutBtn').addEventListener('click', crashCashout);
  document.getElementById('verifyFairnessBtn').addEventListener('click', verifyCrashFairness);
  document.getElementById('closeVerifyBtn').addEventListener('click', function() {
    document.getElementById('verifyModal').classList.add('hidden');
  });
  
  // Coinflip
  document.getElementById('btnHeads').addEventListener('click', function() { selectCoinflipSide('heads'); });
  document.getElementById('btnTails').addEventListener('click', function() { selectCoinflipSide('tails'); });
  document.getElementById('coinflipBetBtn').addEventListener('click', flipCoin);
  
  // Roulette
  document.getElementById('btnRed').addEventListener('click', function() { rouletteBet('red'); });
  document.getElementById('btnBlack').addEventListener('click', function() { rouletteBet('black'); });
  document.getElementById('btnGreen').addEventListener('click', function() { rouletteBet('green'); });
  
  // 3CP
  document.getElementById('threecpAnteBtn').addEventListener('click', place3CPAnte);
  document.getElementById('threecpPlayBtn').addEventListener('click', play3CP);
  document.getElementById('threecpFoldBtn').addEventListener('click', fold3CP);
  
  // Settings
  document.getElementById('formChangePassword').addEventListener('submit', function(e) {
    e.preventDefault();
    changePassword();
  });
  
  document.getElementById('formChangeEmail').addEventListener('submit', function(e) {
    e.preventDefault();
    changeEmail();
  });
}

// ---------- UTILITY FUNCTIONS ----------    
function show(id) { 
  document.getElementById(id).classList.remove('hidden'); 
}

function hide(id) { 
  document.getElementById(id).classList.add('hidden'); 
}

function setText(id, text) { 
  document.getElementById(id).textContent = text; 
}

// Update balance with animation
function updateBalance(newBalance) {
  const balanceElement = document.getElementById('balance');
  
  // Animate the balance change
  balanceElement.classList.add('balance-update');
  
  // Remove animation class after it completes
  setTimeout(() => {
    balanceElement.classList.remove('balance-update');
  }, 500);
  
  // Update the balance value
  userBalance = newBalance;
  balanceElement.textContent = newBalance.toFixed(2);
}

// Check for existing session
function checkSession() {
  authToken = localStorage.getItem('authToken');
  user = localStorage.getItem('user');
  
  if (authToken && user) {
    validateToken(authToken).then(valid => {
      if (valid) {
        afterLogin();
      } else {
        logout(false);
      }
    });
  }
}

// Validate the token with the server
async function validateToken(token) {
  try {
    const res = await fetch(`${API}/balance`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    
    const data = await res.json();
    if (data.success) {
      return true;
    } else {
      return false;
    }
  } catch (err) {
    log("Token validation error: " + err);
    return false;
  }
}

// ---------- AUTH FUNCTIONS ----------
async function login() {
  log("Login function called");
  
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  
  document.getElementById('loginErr').textContent = '';
  
  if (!username || !password) {
    document.getElementById('loginErr').textContent = 'Enter both username and password.';
    return;
  }
  
  // Get captcha response
  let captchaToken = '';
  try {
    captchaToken = hcaptcha.getResponse();
    log("Captcha token: " + (captchaToken ? "received" : "missing"));
  } catch (e) {
    log("Captcha error: " + e);
  }
  
  if (!captchaToken) {
    document.getElementById('loginErr').textContent = 'Please complete the captcha.';
    return;
  }
  
  // Disable login button
  const loginBtn = document.getElementById('loginBtn');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Logging in...';
  
  try {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        captchaToken
      })
    });
    
    const data = await res.json();
    log("Login response: " + JSON.stringify(data));
    
    if (data.success) {
      authToken = data.token;
      user = data.username;
      localStorage.setItem('authToken', authToken);
      localStorage.setItem('user', user);
      afterLogin();
    } else {
      document.getElementById('loginErr').textContent = data.message || 'Login failed.';
      try {
        hcaptcha.reset();
      } catch (e) {
        log("Captcha reset error: " + e);
      }
    }
  } catch (err) {
    document.getElementById('loginErr').textContent = 'Network error. Try again.';
    log("Login network error: " + err);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Login';
  }
}

async function signup() {
  log("Signup function called");
  
  const username = document.getElementById('signupUser').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPass').value;
  
  document.getElementById('signupErr').textContent = '';
  
  if (!username || !email || !password) {
    document.getElementById('signupErr').textContent = 'All fields are required.';
    return;
  }
  
  // Get captcha response
  let captchaToken = '';
  try {
    // Try to get the captcha response from signup captcha
    const captchas = document.querySelectorAll('.h-captcha');
    if (captchas.length > 1) {
      const signupCaptchaElement = document.querySelector('#signupBox .h-captcha');
      if (signupCaptchaElement) {
        const widgetId = signupCaptchaElement.getAttribute('data-hcaptcha-widget-id');
        if (widgetId) {
          captchaToken = hcaptcha.getResponse(widgetId);
        }
      }
    }
    
    // Fallback to any captcha response
    if (!captchaToken) {
      captchaToken = hcaptcha.getResponse();
    }
    
    log("Signup captcha token: " + (captchaToken ? "received" : "missing"));
  } catch (e) {
    log("Signup captcha error: " + e);
  }
  
  if (!captchaToken) {
    document.getElementById('signupErr').textContent = 'Please complete the captcha.';
    return;
  }
  
  // Disable signup button
  const signupBtn = document.getElementById('signupBtn');
  signupBtn.disabled = true;
  signupBtn.textContent = 'Signing up...';
  
  try {
    const res = await fetch(`${API}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        email,
        password,
        captchaToken
      })
    });
    
    const data = await res.json();
    log("Signup response: " + JSON.stringify(data));
    
    if (data.success) {
      // Try to log in automatically
      const loginRes = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          captchaToken
        })
      });
      
      const loginData = await loginRes.json();
      
      if (loginData.success) {
        authToken = loginData.token;
        user = loginData.username;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('user', user);
        afterLogin();
      } else {
        document.getElementById('signupErr').textContent = 'Signup successful! Please log in.';
        document.getElementById('loginBox').classList.remove('hidden');
        document.getElementById('signupBox').classList.add('hidden');
        document.getElementById('loginUser').value = username;
      }
    } else {
      document.getElementById('signupErr').textContent = data.message || 'Signup failed.';
      try {
        hcaptcha.reset();
      } catch (e) {
        log("Signup captcha reset error: " + e);
      }
    }
  } catch (err) {
    document.getElementById('signupErr').textContent = 'Network error. Try again.';
    log("Signup network error: " + err);
  } finally {
    signupBtn.disabled = false;
    signupBtn.textContent = 'Sign Up (Fun Mode)';
  }
}

function afterLogin() {
  hide('loginPage');
  show('mainPage');
  setText('userName', user);
  refreshBalance();
}

function logout(redirect = true) {
  authToken = '';
  user = '';
  localStorage.removeItem('authToken');
  localStorage.removeItem('user');
  
  if (redirect) {
    hide('mainPage');
    hide('crashSection');
    hide('coinflipSection');
    hide('rouletteSection');
    hide('threecpSection');
    hide('settingsSection');
    show('loginPage');
  }
  
  stopCrashPoll();
  
  // Reset hCaptcha
  try {
    hcaptcha.reset();
  } catch (e) {
    log("Captcha reset error during logout: " + e);
  }
}

// ---------- NAVIGATION FUNCTIONS ----------
function showCrashSection() {
  hide('mainPage');
  hide('coinflipSection');
  hide('rouletteSection');
  hide('threecpSection');
  hide('settingsSection');
  show('crashSection');
  startCrashPoll();
}

function showCoinflipSection() {
  hide('mainPage');
  hide('crashSection');
  hide('rouletteSection');
  hide('threecpSection');
  hide('settingsSection');
  show('coinflipSection');
  resetCoinflip();
}

function showRouletteSection() {
  hide('mainPage');
  hide('crashSection');
  hide('coinflipSection');
  hide('threecpSection');
  hide('settingsSection');
  show('rouletteSection');
  resetRoulette();
}

function show3CPSection() {
  hide('mainPage');
  hide('crashSection');
  hide('coinflipSection');
  hide('rouletteSection');
  hide('settingsSection');
  show('threecpSection');
  resetThreecp();
}

function showSettingsSection() {
  hide('mainPage');
  hide('crashSection');
  hide('coinflipSection');
  hide('rouletteSection');
  hide('threecpSection');
  show('settingsSection');
  document.getElementById('settingsMsg').textContent = '';
}

function backToMenu() {
  hide('crashSection');
  hide('coinflipSection');
  hide('rouletteSection');
  hide('threecpSection');
  hide('settingsSection');
  show('mainPage');
  stopCrashPoll();
  refreshBalance();
}

// ---------- BALANCE ----------
async function refreshBalance() {
  if (!authToken) return;
  
  try {
    const res = await fetch(`${API}/balance`, {
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    
    const data = await res.json();
    
    if (data.success) {
      updateBalance(data.balance);
    } else if (data.message === "Invalid token") {
      logout();
    }
  } catch (err) {
    console.error('Balance error:', err);
  }
}

// ---------- ACCOUNT SETTINGS ----------
async function changePassword() {
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmNewPassword = document.getElementById('confirmNewPassword').value;
  const settingsMsg = document.getElementById('settingsMsg');
  
  if (!currentPassword || !newPassword || !confirmNewPassword) {
    settingsMsg.textContent = 'All fields required.';
    return;
  }
  
  if (newPassword !== confirmNewPassword) {
    settingsMsg.textContent = 'Passwords do not match.';
    return;
  }
  
  try {
    const res = await fetch(`${API}/change-password`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        currentPassword,
        newPassword
      })
    });
    
    const data = await res.json();
    
    settingsMsg.textContent = data.success ? 'Password changed successfully!' : (data.message || 'Error changing password.');
    
    if (data.success) {
      document.getElementById('formChangePassword').reset();
    }
  } catch (err) {
    settingsMsg.textContent = 'Network error. Try again.';
  }
}

async function changeEmail() {
  const currentPassword = document.getElementById('currentPassword2').value;
  const newEmail = document.getElementById('newEmail').value;
  const settingsMsg = document.getElementById('settingsMsg');
  
  if (!currentPassword || !newEmail) {
    settingsMsg.textContent = 'All fields required.';
    return;
  }
  
  try {
    const res = await fetch(`${API}/change-email`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        currentPassword,
        newEmail
      })
    });
    
    const data = await res.json();
    
    settingsMsg.textContent = data.success ? 'Email changed successfully!' : (data.message || 'Error changing email.');
    
    if (data.success) {
      document.getElementById('formChangeEmail').reset();
    }
  } catch (err) {
    settingsMsg.textContent = 'Network error. Try again.';
  }
}

// ---------- CRASH GAME ----------
function startCrashPoll() {
  placedBet = null;
  crashRoundId = 0;
  getCrashHistory();
  fetchCrashState();
  if (crashPoll) clearInterval(crashPoll);
  crashPoll = setInterval(fetchCrashState, 1000);
  resetCrashGame();
}

function stopCrashPoll() {
  if (crashPoll) clearInterval(crashPoll);
  crashPoll = null;
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
  if (crashAnimationInterval) clearInterval(crashAnimationInterval);
  crashAnimationInterval = null;
}

function resetCrashGame() {
  if (crashAnimationInterval) {
    clearInterval(crashAnimationInterval);
    crashAnimationInterval = null;
  }
  
  const crashRocket = document.getElementById('crashRocket');
  const crashLine = document.getElementById('crashLine');
  const crashExplosion = document.getElementById('crashExplosion');
  
  if (crashRocket) crashRocket.style.opacity = '0';
  if (crashLine) crashLine.style.height = '0';
  if (crashLine) crashLine.style.width = '0';
  if (crashExplosion) {
    crashExplosion.classList.remove('visible');
    crashExplosion.style.opacity = '0';
  }
  
  document.getElementById('crashMultiplier').textContent = '1.00x';
  currentCrashMultiplier = 1.00;
}

async function fetchCrashState() {
  try {
    const res = await fetch(`${API}/crash/state`, {
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    
    const data = await res.json();
    if (!data.success) {
      log("Error fetching crash state: " + (data.message || "Unknown error"));
      return;
    }
    
    const round = data.round;
    
    // Check if we need to reset UI for new round
    if (crashRoundId !== round.roundId) {
      crashRoundId = round.roundId;
      placedBet = null;
      resetCrashGame();
      
      // Get the server seed hash for this round
      crashSeeds[round.roundId] = round.seedHash;
      
      document.getElementById('crashBetBtn').disabled = false;
      document.getElementById('crashCancelBtn').disabled = true;
      document.getElementById('crashCashoutBtn').disabled = true;
    }
    
    // Handle different states
    if (round.status === 'waiting') {
      // Countdown to next round
      document.getElementById('crashTimer').classList.remove('hidden');
      document.getElementById('countdown').textContent = round.timeLeft;
      document.getElementById('crashBetBtn').disabled = false;
      
      if (round.hasBet) {
        document.getElementById('crashBetBtn').disabled = true;
        document.getElementById('crashCancelBtn').disabled = false;
        placedBet = { active: true };
      }
      
      // Get crash history at the start of waiting period
      if (!crashGameState || crashGameState !== 'waiting') {
        getCrashHistory();
      }
      
      crashGameState = 'waiting';
    } 
    else if (round.status === 'running') {
      // Running game
      document.getElementById('crashTimer').classList.add('hidden');
      document.getElementById('crashBetBtn').disabled = true;
      document.getElementById('crashCancelBtn').disabled = true;
      
      if (round.hasBet && !round.hasCashedOut) {
        document.getElementById('crashCashoutBtn').disabled = false;
        placedBet = { active: true, cashedOut: false };
      } else if (round.hasBet && round.hasCashedOut) {
        document.getElementById('crashCashoutBtn').disabled = true;
        placedBet = { active: true, cashedOut: true };
      }
      
      // Animate multiplier if not already animating
      if (crashGameState !== 'running') {
        startCrashAnimation(round.multiplier);
      } else {
        // Update current multiplier for the animation
        currentCrashMultiplier = round.multiplier;
      }
      
      crashGameState = 'running';
    } 
    else if (round.status === 'crashed') {
      // Crashed
      document.getElementById('crashTimer').classList.add('hidden');
      document.getElementById('crashBetBtn').disabled = true;
      document.getElementById('crashCancelBtn').disabled = true;
      document.getElementById('crashCashoutBtn').disabled = true;
      
      // If we have the animation running, let it finish
      if (crashGameState !== 'crashed') {
        crashExplode();
      }
      
      // If revealed seed is available, store it
      if (round.revealedSeed) {
        crashSeeds[round.roundId + "_seed"] = round.revealedSeed;
      }
      
      crashGameState = 'crashed';
      
      // Refresh balance after crash
      refreshBalance();
    }
  } catch (err) {
    log("Error in crash poll: " + err);
  }
}

async function getCrashHistory() {
  try {
    const res = await fetch(`${API}/history/crash`, {
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    
    const data = await res.json();
    if (data.success) {
      // Update the crash history table
      const tbody = document.querySelector('#crashHistory tbody');
      tbody.innerHTML = '';
      
      // Get last crash multipliers for the top bar
      lastCrashMultipliers = [];
      
      data.history.forEach((round, index) => {
        if (index < 10) {
          lastCrashMultipliers.push(round.crashAt);
        }
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>#${round.roundId}</td>
          <td>${round.crashAt.toFixed(2)}x</td>
          <td><button class="verify-btn" data-round="${round.roundId}" data-hash="${round.seedHash}" data-seed="${round.seed || ''}">Verify</button></td>
          <td>${new Date(round.created).toLocaleTimeString()}</td>
        `;
        tbody.appendChild(tr);
        
        // Store seed information for verification
        crashSeeds[round.roundId] = round.seedHash;
        if (round.seed) {
          crashSeeds[round.roundId + "_seed"] = round.seed;
        }
      });
      
      // Add event listeners to verify buttons
      document.querySelectorAll('.verify-btn').forEach(btn => {
        btn.addEventListener('click', function() {
          const roundId = this.getAttribute('data-round');
          const seedHash = this.getAttribute('data-hash');
          const seed = this.getAttribute('data-seed');
          showVerificationModal(roundId, seedHash, seed);
        });
      });
      
      // Update recent crashes display
      updateRecentCrashes();
    }
  } catch (err) {
    log("Error fetching crash history: " + err);
  }
}

function updateRecentCrashes() {
  const container = document.getElementById('recentCrashesContainer');
  if (!container) return;
  
  container.innerHTML = '';
  
  lastCrashMultipliers.forEach(multiplier => {
    const crashItem = document.createElement('span');
    crashItem.className = `crash-history-item ${multiplier >= 2 ? 'win' : 'lose'}`;
    crashItem.textContent = multiplier.toFixed(2) + 'x';
    container.appendChild(crashItem);
  });
}

function startCrashAnimation(currentMultiplier) {
  const crashRocket = document.getElementById('crashRocket');
  const crashLine = document.getElementById('crashLine');
  const crashGraph = document.getElementById('crashGraph');
  
  if (!crashRocket || !crashLine || !crashGraph) return;
  
  // Make rocket visible
  crashRocket.style.opacity = '1';
  crashRocket.classList.add('visible');
  
  const graphWidth = crashGraph.offsetWidth;
  const graphHeight = crashGraph.offsetHeight;
  
  // Initial position
  crashLine.style.height = '0';
  crashLine.style.width = '2px';
  
  // Animation values
  let lastTimestamp = 0;
  let currentX = 0;
  
  if (crashAnimationInterval) {
    clearInterval(crashAnimationInterval);
  }
  
  crashAnimationInterval = setInterval(() => {
    // Update multiplier display
    document.getElementById('crashMultiplier').textContent = currentCrashMultiplier.toFixed(2) + 'x';
    
    // Calculate rocket position using a logarithmic curve
    const logBase = 10; // Adjust this for different curve steepness
    const x = Math.min(graphWidth * 0.8, (currentCrashMultiplier - 1) * 100);
    const y = Math.max(0, graphHeight - (Math.log(currentCrashMultiplier) / Math.log(logBase)) * graphHeight * 0.8);
    
    // Update line and rocket position
    crashLine.style.width = x + 'px';
    crashLine.style.height = graphHeight - y + 'px';
    crashRocket.style.transform = `translate(${x}px, ${y}px) rotate(-45deg)`;
    
  }, 50);
}

function crashExplode() {
  const crashExplosion = document.getElementById('crashExplosion');
  const crashRocket = document.getElementById('crashRocket');
  const crashGraph = document.getElementById('crashGraph');
  
  if (!crashExplosion || !crashRocket || !crashGraph) return;
  
  // Position explosion at rocket location
  const rocketRect = crashRocket.getBoundingClientRect();
  const graphRect = crashGraph.getBoundingClientRect();
  
  const x = rocketRect.left - graphRect.left + rocketRect.width/2;
  const y = rocketRect.top - graphRect.top + rocketRect.height/2;
  
  crashExplosion.style.left = x + 'px';
  crashExplosion.style.top = y + 'px';
  
  // Hide rocket and show explosion
  crashRocket.style.opacity = '0';
  crashExplosion.style.opacity = '1';
  crashExplosion.classList.add('visible');
  
  // Stop animation
  if (crashAnimationInterval) {
    clearInterval(crashAnimationInterval);
    crashAnimationInterval = null;
  }
}

async function placeCrashBet() {
  const amount = parseFloat(document.getElementById('crashBetAmount').value);
  if (!amount || amount <= 0) {
    document.getElementById('crashMsg').textContent = 'Enter a valid bet amount.';
    return;
  }
  
  try {
    const res = await fetch(`${API}/crash/bet`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ amount })
    });
    
    const data = await res.json();
    
    if (data.success) {
      document.getElementById('crashMsg').textContent = 'Bet placed!';
      document.getElementById('crashBetBtn').disabled = true;
      document.getElementById('crashCancelBtn').disabled = false;
      placedBet = { amount, active: true };
      refreshBalance();
    } else {
      document.getElementById('crashMsg').textContent = data.message || 'Error placing bet.';
    }
  } catch (err) {
    document.getElementById('crashMsg').textContent = 'Network error. Try again.';
  }
}

async function cancelCrashBet() {
  try {
    const res = await fetch(`${API}/crash/cancel-bet`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await res.json();
    
    if (data.success) {
      document.getElementById('crashMsg').textContent = 'Bet cancelled.';
      document.getElementById('crashBetBtn').disabled = false;
      document.getElementById('crashCancelBtn').disabled = true;
      placedBet = null;
      refreshBalance();
    } else {
      document.getElementById('crashMsg').textContent = data.message || 'Error cancelling bet.';
    }
  } catch (err) {
    document.getElementById('crashMsg').textContent = 'Network error. Try again.';
  }
}

async function crashCashout() {
  try {
    const res = await fetch(`${API}/crash/cashout`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await res.json();
    
    if (data.success) {
      document.getElementById('crashMsg').textContent = `Cashed out at ${data.multiplier.toFixed(2)}x! Won ${data.payout.toFixed(2)}`;
      document.getElementById('crashCashoutBtn').disabled = true;
      placedBet.cashedOut = true;
      refreshBalance();
    } else {
      document.getElementById('crashMsg').textContent = data.message || 'Error cashing out.';
    }
  } catch (err) {
    document.getElementById('crashMsg').textContent = 'Network error. Try again.';
  }
}

function showVerificationModal(roundId, seedHash, seed) {
  document.getElementById('verifyRound').textContent = roundId;
  document.getElementById('verifyHash').textContent = seedHash || 'Not available';
  document.getElementById('verifyServerSeed').textContent = seed || 'Not revealed yet';
  
  // Find crash point in history
  const crashPoint = lastCrashMultipliers.find((_, i) => i === parseInt(roundId) - 1) || 'Unknown';
  document.getElementById('verifyCrashPoint').textContent = typeof crashPoint === 'number' ? crashPoint.toFixed(2) + 'x' : crashPoint;
  
  document.getElementById('verifyModal').classList.remove('hidden');
}

function verifyCrashFairness() {
  // Open modal with current round info
  showVerificationModal(crashRoundId, crashSeeds[crashRoundId], crashSeeds[crashRoundId + "_seed"]);
}

// ---------- COINFLIP GAME ----------
function resetCoinflip() {
  coinflipChoice = null;
  document.querySelectorAll('.coin-btn').forEach(btn => {
    btn.classList.remove('selected');
  });
  document.getElementById('coinflipMsg').textContent = '';
  document.getElementById('coinflipResult').textContent = 'Waiting for flip...';
}

function selectCoinflipSide(side) {
  coinflipChoice = side;
  document.querySelectorAll('.coin-btn').forEach(btn => {
    btn.classList.remove('selected');
  });
  document.getElementById(side === 'heads' ? 'btnHeads' : 'btnTails').classList.add('selected');
}

async function flipCoin() {
  if (!coinflipChoice) {
    document.getElementById('coinflipMsg').textContent = 'Choose Heads or Tails first.';
    return;
  }
  
  const amount = parseFloat(document.getElementById('coinflipBetAmount').value);
  if (!amount || amount <= 0) {
    document.getElementById('coinflipMsg').textContent = 'Enter a valid bet amount.';
    return;
  }
  
  try {
    document.getElementById('coinflipBetBtn').disabled = true;
    document.getElementById('coinflipResult').textContent = 'Flipping...';
    
    const res = await fetch(`${API}/coinflip/bet`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ amount, choice: coinflipChoice })
    });
    
    const data = await res.json();
    
    if (data.success) {
      const resultText = `Result: ${data.result.toUpperCase()}<br>` +
                          (data.win ? `You won ${data.payout.toFixed(2)}!` : 'You lost!');
      document.getElementById('coinflipResult').innerHTML = resultText;
      document.getElementById('coinflipMsg').textContent = '';
      refreshBalance();
    } else {
      document.getElementById('coinflipResult').textContent = 'Waiting for flip...';
      document.getElementById('coinflipMsg').textContent = data.message || 'Error flipping coin.';
    }
  } catch (err) {
    document.getElementById('coinflipResult').textContent = 'Waiting for flip...';
    document.getElementById('coinflipMsg').textContent = 'Network error. Try again.';
  } finally {
    document.getElementById('coinflipBetBtn').disabled = false;
  }
}

// ---------- ROULETTE GAME ----------
function resetRoulette() {
  document.getElementById('rouletteMsg').textContent = '';
  document.getElementById('rouletteResult').textContent = 'Waiting for spin...';
  
  // Start polling roulette state
  if (!window.roulettePoll) {
    window.roulettePoll = setInterval(fetchRouletteState, 1000);
  }
}

async function fetchRouletteState() {
  try {
    const res = await fetch(`${API}/roulette/state`, {
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    
    const data = await res.json();
    if (!data.success) return;
    
    const round = data.round;
    
    // Update countdown if waiting
    if (round.status === 'waiting') {
      document.getElementById('rouletteResult').textContent = `Next spin in ${round.timeLeft}s...`;
    } 
    else if (round.status === 'spinning') {
      document.getElementById('rouletteResult').textContent = 'Spinning...';
    } 
    else if (round.status === 'result') {
      // Update wheel rotation to show result
      const wheel = document.getElementById('rouletteWheel');
      if (wheel) {
        // Calculate rotation based on result
        const rotation = 1800 + (round.result * 10);  // Multiple full rotations plus landing position
        wheel.style.transform = `rotate(${rotation}deg)`;
        
        // Update result text
        document.getElementById('rouletteResult').textContent = `Result: ${round.color.toUpperCase()}!`;
        
        // Refresh balance
        refreshBalance();
      }
    }
  } catch (err) {
    console.error('Roulette state error:', err);
  }
}

async function rouletteBet(color) {
  const amount = parseFloat(document.getElementById('rouletteBetAmount').value);
  if (!amount || amount <= 0) {
    document.getElementById('rouletteMsg').textContent = 'Enter a valid bet amount.';
    return;
  }
  
  try {
    document.getElementById('btnRed').disabled = true;
    document.getElementById('btnBlack').disabled = true;
    document.getElementById('btnGreen').disabled = true;
    
    const res = await fetch(`${API}/roulette/bet`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ amount, color })
    });
    
    const data = await res.json();
    
    if (data.success) {
      document.getElementById('rouletteMsg').textContent = `Bet placed on ${color}!`;
      refreshBalance();
    } else {
      document.getElementById('rouletteMsg').textContent = data.message || 'Error placing bet.';
    }
  } catch (err) {
    document.getElementById('rouletteMsg').textContent = 'Network error. Try again.';
  } finally {
    document.getElementById('btnRed').disabled = false;
    document.getElementById('btnBlack').disabled = false;
    document.getElementById('btnGreen').disabled = false;
  }
}

// ---------- 3 CARD POKER ----------
function resetThreecp() {
  document.getElementById('threecpMsg').textContent = '';
  document.getElementById('threecpResult').textContent = 'Waiting for bet...';
  document.getElementById('threecpPlayer').innerHTML = '';
  document.getElementById('threecpDealer').innerHTML = '';
  document.getElementById('threecpAnteBtn').disabled = false;
  document.getElementById('threecpDecisionBtns').classList.add('hidden');
}

function renderPokerHand(cards, elementId, isDealer = false) {
  if (!cards || !cards.length) return;
  
  const handElement = document.getElementById(elementId);
  if (!handElement) return;
  
  const title = isDealer ? "Dealer's Hand:" : "Your Hand:";
  let html = `<h4>${title}</h4><div class="card-row">`;
  
  cards.forEach((card, index) => {
    let cardDisplay = card;
    if (isDealer && cardDisplay === '??') {
      html += `<div class="card back card-animated card-animated-delay-${index}">?</div>`;
    } else {
      const suit = card[card.length - 1];
      const rank = card.slice(0, -1);
      const color = (suit === 'H' || suit === 'D') ? 'red' : 'black';
      const suitSymbol = {
        'H': '♥',
        'D': '♦',
        'C': '♣',
        'S': '♠'
      }[suit] || suit;
      
      html += `<div class="card ${color} card-animated card-animated-delay-${index}">${rank}${suitSymbol}</div>`;
    }
  });
  
  html += '</div>';
  handElement.innerHTML = html;
}

async function place3CPAnte() {
  const amount = parseFloat(document.getElementById('threecpBetAmount').value);
  if (!amount || amount <= 0) {
    document.getElementById('threecpMsg').textContent = 'Enter a valid ante amount.';
    return;
  }
  
  try {
    document.getElementById('threecpAnteBtn').disabled = true;
    
    const res = await fetch(`${API}/3cp/ante`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ amount })
    });
    
    const data = await res.json();
    
    if (data.success) {
      document.getElementById('threecpMsg').textContent = '';
      document.getElementById('threecpResult').textContent = data.msg || 'Hand dealt. Play or Fold?';
      
      // Render cards
      renderPokerHand(data.player, 'threecpPlayer');
      renderPokerHand(data.dealer, 'threecpDealer', true);
      
      // Show decision buttons
      document.getElementById('threecpDecisionBtns').classList.remove('hidden');
      
      refreshBalance();
    } else {
      document.getElementById('threecpMsg').textContent = data.message || 'Error placing ante.';
      document.getElementById('threecpAnteBtn').disabled = false;
    }
  } catch (err) {
    document.getElementById('threecpMsg').textContent = 'Network error. Try again.';
    document.getElementById('threecpAnteBtn').disabled = false;
  }
}

async function play3CP() {
  try {
    document.getElementById('threecpPlayBtn').disabled = true;
    document.getElementById('threecpFoldBtn').disabled = true;
    
    const res = await fetch(`${API}/3cp/play`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken
      }
    });
    
    const data = await res.json();
    
    if (data.success) {
      // Render dealer's real cards
      renderPokerHand(data.dealer, 'threecpDealer');
      
      // Show result
      document.getElementById('threecpResult').textContent = data.win ? 
        `You win! Payout: ${data.payout.toFixed(2)}` : 
        'Dealer wins. Better luck next time!';
      
      // Hide decision buttons
      document.getElementById('threecpDecisionBtns').classList.add('hidden');
      
      // Re-enable ante button for next game
      document.getElementById('threecpAnteBtn').disabled = false;
      
      refreshBalance();
    } else {
      document.getElementById('threecpMsg').textContent = data.message || 'Error playing hand.';
      document.getElementById('threecpPlayBtn').disabled = false;
      document.getElementById('threecpFoldBtn').disabled = false;
    }
  } catch (err) {
    document.getElementById('threecpMsg').textContent = 'Network error. Try again.';
    document.getElementById('threecpPlayBtn').disabled = false;
    document.getElementById('threecpFoldBtn').disabled = false;
  }
}

async function fold3CP() {
  try {
    document.getElementById('threecpPlayBtn').disabled = true;
    document.getElementById('threecpFoldBtn').disabled = true;
    
    const res = await fetch(`${API}/3cp/fold`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken
      }
    });
    
    const data = await res.json();
    
    if (data.success) {
      // Render dealer's real cards
      renderPokerHand(data.dealer, 'threecpDealer');
      
      // Show result
      document.getElementById('threecpResult').textContent = data.msg || 'You folded. You lost your ante.';
      
      // Hide decision buttons
      document.getElementById('threecpDecisionBtns').classList.add('hidden');
      
      // Re-enable ante button for next game
      document.getElementById('threecpAnteBtn').disabled = false;
      
      refreshBalance();
    } else {
      document.getElementById('threecpMsg').textContent = data.message || 'Error folding hand.';
      document.getElementById('threecpPlayBtn').disabled = false;
      document.getElementById('threecpFoldBtn').disabled = false;
    }
  } catch (err) {
    document.getElementById('threecpMsg').textContent = 'Network error. Try again.';
    document.getElementById('threecpPlayBtn').disabled = false;
    document.getElementById('threecpFoldBtn').disabled = false;
  }
}

// Clean up event handlers when the page is unloaded
window.addEventListener('beforeunload', function() {
  stopCrashPoll();
  if (window.roulettePoll) {
    clearInterval(window.roulettePoll);
  }
});
