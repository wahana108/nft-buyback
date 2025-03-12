console.log('script.js loaded');
const supabase = window.supabase.createClient('https://jmqwuaybvruzxddsppdh.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptcXd1YXlidnJ1enhkZHNwcGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA0MTUxNzEsImV4cCI6MjA1NTk5MTE3MX0.ldNdOrsb4BWyFRwZUqIFEbmU0SgzJxiF_Z7eGZPKZJg');
let token;

async function login() {
  console.log('Login function called');
  try {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    console.log('Attempting login with:', { email, password });
    if (!email || !password) throw new Error('Email and password are required');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    });
    if (error) throw error;
    token = data.session.access_token;
    console.log('Login successful:', { token, user_id: data.user.id });
    localStorage.setItem('authToken', token);
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    loadVendorNFTs();
    loadPendingRequests();
  } catch (error) {
    console.error('Login failed:', error.message);
    alert('Login failed: ' + error.message);
  }
}

async function register() {
  console.log('Register function called');
  try {
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    console.log('Attempting register with:', { email, password });
    if (!email || !password) throw new Error('Email and password are required');
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password
    });
    if (error) throw error;
    console.log('Registration successful:', data);
    alert('Registration successful! Please login.');
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
  } catch (error) {
    console.error('Registration failed:', error.message);
    alert('Registration failed: ' + error.message);
  }
}

async function loadVendorNFTs() {
  try {
    const res = await fetch('/vendor-nfts', { headers: { Authorization: token } });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const nfts = await res.json();
    console.log('Vendor NFTs loaded:', nfts);
    const list = document.getElementById('vendor-nfts');
    list.innerHTML = '';
    if (nfts.length === 0) {
      list.innerHTML = '<p>No NFTs created by you.</p>';
    } else {
      nfts.forEach(nft => {
        const div = document.createElement('div');
        div.innerHTML = `
          <p>ID: ${nft.id} | Title: ${nft.title} | Contact: ${nft.description}</p>
        `;
        list.appendChild(div);
      });
    }
  } catch (error) {
    console.error('Error loading vendor NFTs:', error.message);
  }
}

async function requestBuyback() {
  try {
    const nftId = document.getElementById('nft-id').value;
    if (!nftId) {
      document.getElementById('request-message').textContent = 'Error: Please enter an NFT ID';
      return;
    }
    console.log('Requesting buyback for NFT:', nftId);
    const res = await fetch('/request-buyback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ nft_id: nftId })
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    console.log('Buyback requested');
    document.getElementById('request-message').textContent = 'Buyback requested—awaiting vendor confirmation';
    loadPendingRequests();
  } catch (error) {
    console.error('Error requesting buyback:', error.message);
    document.getElementById('request-message').textContent = 'Error: ' + error.message;
  }
}

async function loadPendingRequests() {
  const pendingDiv = document.getElementById('pending-requests'); // Pindah ke sini
  try {
    const res = await fetch('/pending-requests', { headers: { Authorization: token } });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const requests = await res.json();
    pendingDiv.innerHTML = '';
    if (requests.length === 0) {
      pendingDiv.innerHTML = '<p>No pending requests.</p>';
    } else {
      requests.forEach(req => {
        if (req.type === 'vendor' && req.status === 'pending') {
          pendingDiv.innerHTML += `
            <p>
              NFT ID: ${req.nft_id} | Buyer: ${req.buyer_id} | Email: ${req.email}
              <input id="proof-${req.id}" placeholder="Proof URL"><br>
              <button class="confirm-btn" data-req-id="${req.id}">Confirm Buyback</button>
              <button class="reject-btn" data-req-id="${req.id}">Reject Buyback</button>
            </p>`;
        } else if (req.type === 'buyer' && req.status === 'pending') {
          pendingDiv.innerHTML += `
            <p>
              NFT ID: ${req.nft_id} | Vendor: ${req.vendor_id} | Email: ${req.email}
              <button class="cancel-btn" data-req-id="${req.id}">Cancel Buyback</button>
            </p>`;
        } else if (req.type === 'buyer' && req.status === 'confirmed') {
          pendingDiv.innerHTML += `
            <p>
              NFT ID: ${req.nft_id} | Vendor: ${req.vendor_id} | Email: ${req.email}
              Proof: <a href="${req.proof_url}" target="_blank">View</a>
              <button class="complete-btn" data-req-id="${req.id}">Complete Buyback</button>
            </p>`;
        }
      });
      document.querySelectorAll('.confirm-btn').forEach(btn => {
        btn.addEventListener('click', () => confirmBuyback(btn.getAttribute('data-req-id')));
      });
      document.querySelectorAll('.complete-btn').forEach(btn => {
        btn.addEventListener('click', () => completeBuyback(btn.getAttribute('data-req-id')));
      });
      document.querySelectorAll('.cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => cancelBuyback(btn.getAttribute('data-req-id')));
      });
      document.querySelectorAll('.reject-btn').forEach(btn => {
        btn.addEventListener('click', () => rejectBuyback(btn.getAttribute('data-req-id')));
      });
    }
  } catch (error) {
    console.error('Error loading pending requests:', error.message);
    pendingDiv.innerHTML = `<p>Error: ${error.message}</p>`;
  }
}

async function confirmBuyback(requestId) {
  try {
    const proofUrl = document.getElementById(`proof-${requestId}`).value;
    console.log('Confirming buyback:', requestId);
    const res = await fetch('/confirm-buyback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ request_id: requestId, proof_url: proofUrl })
    });
    if (!res.ok) throw new Error(`Confirm failed: ${res.status}`);
    console.log('Buyback confirmed');
    loadPendingRequests();
  } catch (error) {
    console.error('Error confirming buyback:', error.message);
  }
}

async function completeBuyback(requestId) {
  try {
    console.log('Completing buyback:', requestId);
    const res = await fetch('/complete-buyback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ request_id: requestId })
    });
    if (!res.ok) throw new Error(`Complete failed: ${res.status}`);
    console.log('Buyback completed');
    loadPendingRequests();
  } catch (error) {
    console.error('Error completing buyback:', error.message);
  }
}

async function cancelBuyback(requestId) {
  try {
    console.log('Canceling buyback:', requestId);
    const res = await fetch('/cancel-buyback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ request_id: requestId })
    });
    if (!res.ok) throw new Error(`Cancel failed: ${res.status}`);
    console.log('Buyback canceled');
    loadPendingRequests();
  } catch (error) {
    console.error('Error canceling buyback:', error.message);
  }
}

async function rejectBuyback(requestId) {
  try {
    console.log('Rejecting buyback:', requestId);
    const res = await fetch('/reject-buyback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ request_id: requestId })
    });
    if (!res.ok) throw new Error(`Reject failed: ${res.status}`);
    console.log('Buyback rejected');
    loadPendingRequests();
  } catch (error) {
    console.error('Error rejecting buyback:', error.message);
  }
}

function logout() {
  console.log('Logout function called');
  localStorage.removeItem('authToken');
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('login-form').style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded');
  document.getElementById('login-btn').addEventListener('click', login);
  document.getElementById('register-btn').addEventListener('click', register);
  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('request-buyback-btn').addEventListener('click', requestBuyback);
  document.getElementById('show-register-link').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
  });
  document.getElementById('show-login-link').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
  });
  // Logika untuk tombol Back (dipisahkan)
  const backButton = document.getElementById('back-to-mastermind');
  if (backButton) {
    backButton.addEventListener('click', () => {
      window.location.href = 'https://nft-main-bice.vercel.app';
    });
  }

});
