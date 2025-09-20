// controllers/authController.js
const { getUserByEmail } = require('../models/userModel');
const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { sendEmail } = require('../utils/email');

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
    // Use service role for administrative create
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
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
    // Ensure admins always have full permissions marker
    const permissionsToStore = role === 'admin' ? { tier: '*' } : permissions;

    const { error: insertError } = await supabaseAdmin
      .from('users_app')
      .insert([
        {
          id: userId,
          email,
          full_name,
          company_name,
          role,
          permissions: permissionsToStore,
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

// Admin invites a user: sends a brandable invite link so the user sets their own password
async function inviteUser(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }
  const token = authHeader.split(' ')[1];

  try {
    // Verify caller
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    const { data: me, error: meErr } = await supabase
      .from('users_app')
      .select('role')
      .eq('id', user.id)
      .single();
    if (meErr) return res.status(500).json({ error: 'Failed to verify user role' });
    if (me.role !== 'admin') return res.status(403).json({ error: 'Forbidden: Admins only' });

    const { email, full_name, company_name, role = 'client', permissions = {} } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const FRONTEND_URL = process.env.FRONTEND_URL;
    // Generate an invite link (we will email with our own template)
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo: `${FRONTEND_URL}/auth/new-password` },
    });
    if (linkError) return res.status(400).json({ error: linkError.message });

    const invitedUserId = linkData?.user?.id;
    if (invitedUserId) {
      await supabase
        .from('users_app')
        .upsert({ id: invitedUserId, email, full_name, company_name, role, permissions });
    }

    // Send branded email with action_link
    try {
      const actionLink = linkData?.properties?.action_link;
      console.log('actionLink', actionLink);
      await sendEmail({
        to: email,
        subject: 'You are invited to Scriptiflow',
        text: `Welcome to Scriptiflow! Set your password using this link: ${actionLink}`,
        html: `<p>Welcome to Scriptiflow!</p><p>Please click the button below to set your password and complete your account setup.</p><p><a href="${actionLink}" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none;">Set your password</a></p>`
      });
    } catch (e) {
      console.log('Invite email skipped/failed:', e?.message || e);
    }

    return res.status(200).json({ status: 'invited', user_id: invitedUserId });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

// Forgot password: generate a recovery link and email to user
async function forgotPassword(req, res) {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const FRONTEND_URL = process.env.FRONTEND_URL;
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${FRONTEND_URL}/auth/new-password` },
    });
    if (error) return res.status(400).json({ error: error.message });

    try {
      const actionLink = data?.properties?.action_link;
      console.log('actionLink', actionLink);
      await sendEmail({
        to: email,
        subject: 'Reset your password',
        text: `Reset your password using this link: ${actionLink}`,
        html: `<p>We received a request to reset your password.</p><p><a href="${actionLink}" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none;">Reset Password</a></p>`
      });
    } catch (e) {
      console.log('Recovery email skipped/failed:', e?.message || e);
    }
    return res.json({ status: 'sent' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

// Set a new password using a valid Supabase session (tokens from email link)
async function setPassword(req, res) {
  const authHeader = req.headers.authorization;
  const refreshToken = req.headers['x-refresh-token'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }
  const token = authHeader.split(' ')[1];
  const { password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const { error: sessionError } = await supabase.auth.setSession({ access_token: token, refresh_token: refreshToken || null });
    if (sessionError) return res.status(401).json({ error: 'Invalid or expired session' });
    const { error: updError } = await supabase.auth.updateUser({ password });
    if (updError) return res.status(400).json({ error: updError.message });
    return res.json({ status: 'password_set' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

module.exports = { login, register, refresh, inviteUser, forgotPassword, setPassword };