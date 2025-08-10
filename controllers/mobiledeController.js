// controllers/mobiledeController.js
const supabase = require('../config/supabaseClient');
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
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (sessionError) {
      console.error('Session error:', sessionError.message);
      return res.status(401).json({ error: 'Unauthorized: Failed to set session', details: sessionError.message });
    }

    if (!sessionData.user) {
      console.error('No user in session');
      return res.status(401).json({ error: 'Unauthorized: No user found in session' });
    }

    const userId = sessionData.user.id;
    const { iv, encryptedData } = encrypt(password);

    console.log('Upserting credentials:', { user_id: userId, username, encrypted_password: `${iv}:${encryptedData}` });

    const { error } = await supabase
      .from('mobile_de_credentials')
      .upsert(
        { user_id: userId, username, encrypted_password: `${iv}:${encryptedData}` },
        { onConflict: ['user_id'] } // Ensure array syntax for onConflict
      );

    if (error) {
      console.error('Supabase upsert error:', error.message);
      return res.status(500).json({ error: 'Failed to save credentials', details: error.message });
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
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (sessionError) {
      console.error('Session error:', sessionError.message);
      return res.status(401).json({ error: 'Unauthorized: Failed to set session', details: sessionError.message });
    }

    if (!sessionData.user) {
      console.error('No user in session');
      return res.status(401).json({ error: 'Unauthorized: No user found in session' });
    }

    const userId = sessionData.user.id;

    const { data, error } = await supabase
      .from('mobile_de_credentials')
      .select('username, encrypted_password')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('Supabase select error:', error.message);
      return res.status(500).json({ error: 'Failed to retrieve credentials', details: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: 'No credentials found' });
    }

    // Decrypt password if needed, but for security, return masked or omit
    // const [iv, encryptedPassword] = data.encrypted_password.split(':');
    // const password = decrypt(encryptedPassword, iv);

    res.json({ username: data.username });
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
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (sessionError) {
      console.error('Session error:', sessionError.message);
      return res.status(401).json({ error: 'Unauthorized: Failed to set session', details: sessionError.message });
    }

    if (!sessionData.user) {
      console.error('No user in session');
      return res.status(401).json({ error: 'Unauthorized: No user found in session' });
    }

    const userId = sessionData.user.id;
    const { iv, encryptedData } = encrypt(password);

    const { error } = await supabase
      .from('mobile_de_credentials')
      .update({ username, encrypted_password: `${iv}:${encryptedData}` })
      .eq('user_id', userId);

    if (error) {
      console.error('Supabase update error:', error.message);
      return res.status(500).json({ error: 'Failed to update credentials', details: error.message });
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
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (sessionError) {
      console.error('Session error:', sessionError.message);
      return res.status(401).json({ error: 'Unauthorized: Failed to set session', details: sessionError.message });
    }

    if (!sessionData.user) {
      console.error('No user in session');
      return res.status(401).json({ error: 'Unauthorized: No user found in session' });
    }

    const userId = sessionData.user.id;

    const { error } = await supabase
      .from('mobile_de_credentials')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('Supabase delete error:', error.message);
      return res.status(500).json({ error: 'Failed to delete credentials', details: error.message });
    }

    res.json({ message: 'mobile.de credentials deleted successfully' });
  } catch (err) {
    console.error('Server error:', err.message, err.stack);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};