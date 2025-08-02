document.getElementById('loginButton').onclick = async function() {
    console.log("Login button clicked");  // Debug log
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
    console.log("Attempting login with:", username);  // Debug log
    try {
        const res = await fetch(`${API}/api/login`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({username, password})
        });
        console.log("Fetch sent, status:", res.status);  // Debug log

        let data;
        try {
            data = await res.json();
            console.log("Fetch response:", data);  // Debug log
        } catch(jsonErr) {
            console.error("Failed to parse JSON from login response", jsonErr);
            errorEl.textContent = 'Bad server response (not JSON)';
            errorEl.classList.remove('hidden');
            return;
        }

        if (data.success && data.token) {
            console.log("Login success, received token:", data.token);  // Debug log
            authToken = data.token;
            localStorage.setItem('token', authToken);
            localStorage.setItem('username', data.username);
            showGame();
            fetchBalance();
        } else {
            console.warn("Login failed:", data.message);  // Debug log
            errorEl.textContent = data.message || 'Login failed.';
            errorEl.classList.remove('hidden');
        }
    } catch (e) {
        console.error("Network or code error during login", e);  // Debug log
        errorEl.textContent = 'Network error.';
        errorEl.classList.remove('hidden');
    }
};
