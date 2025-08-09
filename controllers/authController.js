// controllers/authController.js
const { getUserByEmail } = require('../models/userModel');
const supabase = require('../config/supabaseClient');

async function register(req, res) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verify Supabase JWT
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      console.error('Invalid token:', error?.message || 'No user found');
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // Check if user is an admin by querying users_app
    const { data: userData, error: userError } = await supabase
      .from('users_app')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError) {
      console.error('Supabase User Fetch Error:', userError.message);
      return res.status(500).json({ error: 'Failed to verify user role' });
    }

    if (userData.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admins only' });
    }

    const { email, password, full_name, company_name, role = 'user', permissions = {} } = req.body;

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      console.error('Supabase Auth Error:', authError.message);
      return res.status(400).json({ error: authError.message });
    }

    const userId = authData.user.id;

    // Insert user into users_app table
    const { error: insertError } = await supabase
      .from('users_app')
      .insert([
        {
          id: userId,
          email,
          full_name,
          company_name,
          role,
          permissions,
        },
      ]);

    if (insertError) {
      console.error('Supabase Insert Error:', insertError.message);
      return res.status(400).json({ error: insertError.message });
    }

    return res.status(201).json({ message: 'User registered successfully', userId });
  } catch (err) {
    console.error('Register error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function login(req, res) {
  const { email, password } = req.body;

  const { data: sessionData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError) {
    console.error('Supabase Auth Error:', authError.message);
    return res.status(401).json({ error: authError.message });
  }

  // Get user metadata from users_app table
  const { data: userData, error: userError } = await supabase
    .from('users_app')
    .select('*')
    .eq('id', sessionData.user.id)
    .single();

  if (userError) {
    console.error('Supabase User Fetch Error:', userError.message);
    return res.status(500).json({ error: userError.message });
  }

  return res.status(200).json({
    status: 'success',
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
    expires_in: sessionData.session.expires_in,
    expires_at: sessionData.session.expires_at,
    user: userData,
  });
}

async function refresh(req, res) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing refresh token' });
  }

  const refreshToken = authHeader.split(' ')[1];

  try {
    const { data: sessionData, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error) {
      console.error('Supabase Refresh Error:', error.message);
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Get user metadata from users_app table
    const { data: userData, error: userError } = await supabase
      .from('users_app')
      .select('*')
      .eq('id', sessionData.user.id)
      .single();

    if (userError) {
      console.error('Supabase User Fetch Error:', userError.message);
      return res.status(500).json({ error: userError.message });
    }

    return res.status(200).json({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
      expires_in: sessionData.session.expires_in,
      expires_at: sessionData.session.expires_at,
      user: userData,
    });
  } catch (err) {
    console.error('Refresh error:', err.message);
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
}

module.exports = { login, register, refresh };