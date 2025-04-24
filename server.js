const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const app = express();
const port = process.env.PORT || 3002;

const supabaseUrl = 'https://oqquvpjikdbjlagdlbhp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xcXV2cGppa2RiamxhZ2RsYmhwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NDk1MTgwOCwiZXhwIjoyMDYwNTI3ODA4fQ.cJri-wLQcDod3J49fUKesAY2cnghU3jtlD4BiuYMelw'; // Ganti dengan service_role key dari Supabase Dashboard
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization;
  console.log('Auth token:', token);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    console.error('Auth error:', error?.message);
    return res.status(401).send('Unauthorized');
  }
  console.log('Authenticated user:', user.id, user.email);
  req.user = user;
  next();
};

app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Registering user:', email);
    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });
    if (error) {
      console.error('Auth signup error:', error.message);
      throw error;
    }
    const user = data.user;
    console.log('User registered in auth:', user.id, user.email);
    const { error: userSyncError } = await supabase
      .from('users')
      .insert({ id: user.id, email: user.email, created_at: new Date().toISOString() });
    if (userSyncError) {
      console.error('Insert users error:', userSyncError.message);
      throw userSyncError;
    }
    console.log('User added to users:', user.id);
    res.json({ message: 'Registration successful', user });
  } catch (error) {
    console.error('Registration failed:', error.message);
    res.status(500).send(error.message);
  }
});

app.get('/vendor-nfts', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('nfts')
      .select('id, title, description')
      .eq('vendor_id', req.user.id);
    if (error) throw error;
    console.log('Vendor NFTs:', data);
    res.json(data);
  } catch (error) {
    console.error('Error fetching vendor NFTs:', error.message);
    res.status(500).send(error.message);
  }
});

app.post('/request-buyback', authenticate, async (req, res) => {
  try {
    const { nft_id } = req.body;
    console.log('Requesting buyback for NFT:', nft_id);
    const { data: nftData, error: nftError } = await supabase
      .from('nfts')
      .select('vendor_id, description')
      .eq('id', nft_id)
      .single();
    if (nftError || !nftData) {
      console.error('NFT not found:', nftError?.message || 'No data');
      return res.status(404).send('NFT not found');
    }

    const { data: existingRequest, error: checkError } = await supabase
      .from('buyback2')
      .select('id')
      .eq('nft_id', nft_id)
      .eq('buyer_id', req.user.id)
      .eq('status', 'pending');
    if (checkError) throw checkError;
    if (existingRequest?.length > 0) {
      console.log('Duplicate request detected');
      return res.status(400).send('You already requested buyback for this NFT');
    }

    const { error } = await supabase
      .from('buyback2')
      .insert({
        nft_id,
        vendor_id: nftData.vendor_id,
        buyer_id: req.user.id,
        status: 'pending',
        created_at: new Date().toISOString()
      });
    if (error) throw error;
    console.log('Buyback requested');
    res.send('Buyback requested—awaiting vendor confirmation');
  } catch (error) {
    console.error('Error requesting buyback:', error.message);
    res.status(500).send(error.message);
  }
});

app.get('/pending-requests', authenticate, async (req, res) => {
  try {
    console.log('Fetching pending requests for user:', req.user.id);
    const { data: vendorData, error: vendorError } = await supabase
      .from('buyback2')
      .select('id, nft_id, buyer_id, proof_url, status')
      .eq('vendor_id', req.user.id)
      .in('status', ['pending', 'rejected']);
    if (vendorError) throw vendorError;
    const { data: buyerData, error: buyerError } = await supabase
      .from('buyback2')
      .select('id, nft_id, vendor_id, proof_url, status')
      .eq('buyer_id', req.user.id)
      .in('status', ['pending', 'confirmed']);
    if (buyerError) throw buyerError;

    const pendingRequests = await Promise.all([
      ...vendorData.map(async req => {
        const { data: buyer, error } = await supabase
          .from('users')
          .select('email')
          .eq('id', req.buyer_id)
          .single();
        return { ...req, type: 'vendor', email: buyer?.email || req.buyer_id };
      }),
      ...buyerData.map(async req => {
        const { data: nft, error } = await supabase
          .from('nfts')
          .select('description')
          .eq('id', req.nft_id)
          .single();
        const parts = nft?.description ? nft.description.split(' | ') : [req.vendor_id];
        const vendorEmail = parts.length > 1 ? parts[parts.length - 1] : parts[0];
        return { ...req, type: 'buyer', email: vendorEmail };
      })
    ]);
    console.log('Pending requests:', pendingRequests);
    res.json(pendingRequests);
  } catch (error) {
    console.error('Error fetching pending requests:', error.message);
    res.status(500).send(error.message);
  }
});

app.post('/confirm-buyback', authenticate, async (req, res) => {
  try {
    const { request_id, proof_url } = req.body;
    console.log('Confirming buyback:', request_id);
    const { data: reqData, error: reqError } = await supabase
      .from('buyback2')
      .select('vendor_id, status')
      .eq('id', request_id)
      .single();
    if (reqError) throw reqError;
    if (reqData.vendor_id !== req.user.id) return res.status(403).send('Unauthorized');
    if (reqData.status !== 'pending') return res.status(400).send('Request already processed');

    const { error } = await supabase
      .from('buyback2')
      .update({ status: 'confirmed', proof_url, confirmed_at: new Date().toISOString() })
      .eq('id', request_id);
    if (error) throw error;
    console.log('Buyback confirmed');
    res.send('Buyback confirmed—awaiting buyer confirmation');
  } catch (error) {
    console.error('Error confirming buyback:', error.message);
    res.status(500).send(error.message);
  }
});

app.post('/complete-buyback', authenticate, async (req, res) => {
  try {
    const { request_id } = req.body;
    console.log('Completing buyback:', request_id);
    if (!request_id) {
      console.error('No request_id provided');
      return res.status(400).send('Request ID is required');
    }

    const { data: reqData, error: reqError } = await supabase
      .from('buyback2')
      .select('buyer_id, vendor_id, status')
      .eq('id', request_id)
      .single();
    if (reqError) throw reqError;
    if (!reqData) return res.status(404).send('Request not found');
    if (reqData.buyer_id !== req.user.id) return res.status(403).send('Unauthorized');
    if (reqData.status !== 'confirmed') return res.status(400).send('Request not confirmed by vendor');

    const { error: updateError } = await supabase
      .from('buyback2')
      .update({ status: 'completed' })
      .eq('id', request_id);
    if (updateError) throw updateError;

    const { data: scoreData, error: scoreFetchError } = await supabase
      .from('vendor_score')
      .select('score')
      .eq('vendor_id', reqData.vendor_id)
      .maybeSingle();
    if (scoreFetchError) throw scoreFetchError;

    const currentScore = scoreData ? scoreData.score : 0;
    const { error: scoreError } = await supabase
      .from('vendor_score')
      .upsert(
        { vendor_id: reqData.vendor_id, score: currentScore + 1, last_updated: new Date().toISOString() },
        { onConflict: 'vendor_id' }
      );
    if (scoreError) throw scoreError;

    console.log('Buyback completed');
    res.send('Buyback completed');
  } catch (error) {
    console.error('Error completing buyback:', error.message);
    res.status(500).send(error.message);
  }
});

app.post('/cancel-buyback', authenticate, async (req, res) => {
  try {
    const { request_id } = req.body;
    console.log('Canceling buyback:', request_id);
    const { data: reqData, error: reqError } = await supabase
      .from('buyback2')
      .select('buyer_id, status')
      .eq('id', request_id)
      .single();
    if (reqError) throw reqError;
    if (reqData.buyer_id !== req.user.id) return res.status(403).send('Unauthorized');
    if (reqData.status !== 'pending') return res.status(400).send('Request already processed');

    const { error } = await supabase
      .from('buyback2')
      .delete()
      .eq('id', request_id);
    if (error) throw error;
    console.log('Buyback canceled');
    res.send('Buyback request canceled');
  } catch (error) {
    console.error('Error canceling buyback:', error.message);
    res.status(500).send(error.message);
  }
});

app.post('/reject-buyback', authenticate, async (req, res) => {
  try {
    const { request_id } = req.body;
    console.log('Rejecting buyback:', request_id);
    const { data: reqData, error: reqError } = await supabase
      .from('buyback2')
      .select('vendor_id, status')
      .eq('id', request_id)
      .single();
    if (reqError) throw reqError;
    if (reqData.vendor_id !== req.user.id) return res.status(403).send('Unauthorized');
    if (reqData.status !== 'pending') return res.status(400).send('Request already processed');

    const { error } = await supabase
      .from('buyback2')
      .update({ status: 'rejected' })
      .eq('id', request_id);
    if (error) throw error;
    console.log('Buyback rejected');
    res.send('Buyback request rejected');
  } catch (error) {
    console.error('Error rejecting buyback:', error.message);
    res.status(500).send(error.message);
  }
});

app.get('/', (req, res) => {
  console.log('Serving index.html from public');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
