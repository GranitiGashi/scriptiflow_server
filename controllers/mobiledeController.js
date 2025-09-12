// controllers/mobiledeController.js
const supabase = require('../config/supabaseClient');
const { getUserFromRequest } = require('../utils/authUser');
const { encrypt, decrypt } = require('../utils/crypto');

// controllers/mobiledeController.js
exports.connectMobile = async (req, res) => {
  const { username, password } = req.body;
  const accessToken = req.headers.authorization?.split('Bearer ')[1];
  const refreshToken = req.headers['x-refresh-token'];

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const sessionData = { user };

    if (!sessionData.user) {
      console.error('No user in session');
      return res.status(401).json({ error: 'Unauthorized: No user found in session' });
    }

    const userId = sessionData.user.id;
    const { iv, encryptedData } = encrypt(password);

    console.log('Upserting credentials:', { user_id: userId, username, encrypted_password: `${iv}:${encryptedData}` });

    const upsertRes = await supabase
      .from('mobile_de_credentials')
      .upsert(
        { user_id: userId, username, encrypted_password: `${iv}:${encryptedData}` },
        { onConflict: ['user_id'] }
      );

    if (upsertRes.error) {
      console.error('Supabase upsert error:', upsertRes.error.message);
      return res.status(500).json({ error: 'Failed to save credentials', details: upsertRes.error.message });
    }

    res.json({ message: 'mobile.de credentials saved successfully' });
  } catch (err) {
    console.error('Server error:', err.message, err.stack);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

exports.getMobileCredentials = async (req, res) => {
  const accessToken = req.headers.authorization?.split('Bearer ')[1];
  const refreshToken = req.headers['x-refresh-token'];

  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const sessionData = { user };

    if (!sessionData.user) {
      console.error('No user in session');
      return res.status(401).json({ error: 'Unauthorized: No user found in session' });
    }

    const userId = sessionData.user.id;

    const selectRes = await supabase
      .from('mobile_de_credentials')
      .select('username, encrypted_password')
      .eq('user_id', userId)
      .single();

    if (selectRes.error) {
      console.error('Supabase select error:', selectRes.error.message);
      return res.status(500).json({ error: 'Failed to retrieve credentials', details: selectRes.error.message });
    }

    const data = selectRes.data;
    if (!data) {
      return res.status(404).json({ error: 'No credentials found' });
    }

    // Decrypt password if needed, but for security, return masked or omit
    const [iv, encryptedPassword] = data.encrypted_password.split(':');
    const password = decrypt(encryptedPassword, iv);

    res.json({ username: data.username, password: password });
  } catch (err) {
    console.error('Server error:', err.message, err.stack);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

exports.editMobileCredentials = async (req, res) => {
  const { username, password } = req.body;
  const accessToken = req.headers.authorization?.split('Bearer ')[1];
  const refreshToken = req.headers['x-refresh-token'];

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const sessionData = { user };

    if (!sessionData.user) {
      console.error('No user in session');
      return res.status(401).json({ error: 'Unauthorized: No user found in session' });
    }

    const userId = sessionData.user.id;
    const { iv, encryptedData } = encrypt(password);

    const updateRes = await supabase
      .from('mobile_de_credentials')
      .update({ username, encrypted_password: `${iv}:${encryptedData}` })
      .eq('user_id', userId);

    if (updateRes.error) {
      console.error('Supabase update error:', updateRes.error.message);
      return res.status(500).json({ error: 'Failed to update credentials', details: updateRes.error.message });
    }

    res.json({ message: 'mobile.de credentials updated successfully' });
  } catch (err) {
    console.error('Server error:', err.message, err.stack);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

exports.deleteMobileCredentials = async (req, res) => {
  const accessToken = req.headers.authorization?.split('Bearer ')[1];
  const refreshToken = req.headers['x-refresh-token'];

  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const sessionData = { user };

    if (!sessionData.user) {
      console.error('No user in session');
      return res.status(401).json({ error: 'Unauthorized: No user found in session' });
    }

    const userId = sessionData.user.id;

    const { error: deleteError } = await supabase
      .from('mobile_de_credentials')
      .delete()
      .eq('user_id', userId);

    if (deleteError) {
      console.error('Supabase delete error:', deleteError.message);
      return res.status(500).json({ error: 'Failed to delete credentials', details: deleteError.message });
    }

    res.json({ message: 'mobile.de credentials deleted successfully' });
  } catch (err) {
    console.error('Server error:', err.message, err.stack);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

exports.getUserCars = async (req, res) => {
  const accessToken = req.headers.authorization?.split('Bearer ')[1];
  const refreshToken = req.headers['x-refresh-token'];

  const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
  if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
  const user = authRes.user;
  const sessionData = { user };

  const userId = sessionData.user.id;

  const credRes = await supabase
    .from('mobile_de_credentials')
    .select('username, encrypted_password')
    .eq('user_id', userId)
    .single();

  if (credRes.error || !credRes.data) {
    return res.status(404).json({ error: 'No credentials found' });
  }

  const [iv, encryptedPassword] = credRes.data.encrypted_password.split(':');
  const password = decrypt(encryptedPassword, iv);

  // Call mobile.de API
  const response = await fetch(`https://services.mobile.de/search-api/search`, {
    method: 'GET',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${credRes.data.username}:${password}`).toString('base64'),
      'Accept': 'application/json'
    }
  });

  const cars = await response.json();
  res.json(cars);
};