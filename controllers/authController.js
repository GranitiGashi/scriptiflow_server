// controllers/authController.js
const { getUserByEmail } = require('../models/userModel');
const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { sendEmail } = require('../utils/email');
const { validatePasswordStrength } = require('../utils/passwordPolicy');
const { sign: signState, verify: verifyState } = require('../utils/stateToken');

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

  // Validate input
  if (!email || !password) {
    console.error('Login attempt with missing credentials');
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const { data: sessionData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      console.error('Supabase Auth Error:', {
        message: authError.message,
        status: authError.status,
        email: email // Log email for debugging (be careful in production)
      });
      return res.status(401).json({ error: authError.message });
    }

    if (!sessionData?.session || !sessionData?.user) {
      console.error('Login successful but session/user data missing');
      return res.status(500).json({ error: 'Authentication failed - invalid session data' });
    }

  // Get user metadata from users_app table; auto-provision if missing
  let { data: userData, error: userError } = await supabase
    .from('users_app')
    .select('*')
    .eq('id', sessionData.user.id)
    .maybeSingle();

  if (!userData) {
    // Create a minimal profile row if absent
    const { data: created, error: upsertErr } = await supabaseAdmin
      .from('users_app')
      .upsert({
        id: sessionData.user.id,
        email: sessionData.user.email,
        role: 'client',
        permissions: { tier: 'basic' },
      }, { onConflict: 'id' })
      .select('*')
      .single();
    if (!upsertErr) {
      userData = created;
    }
  }

    console.log('Login successful for user:', sessionData.user.id);
    return res.status(200).json({
      status: 'success',
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
      expires_in: sessionData.session.expires_in,
      expires_at: sessionData.session.expires_at,
      user: userData,
    });
  } catch (err) {
    console.error('Login error:', {
      message: err.message,
      stack: err.stack
    });
    return res.status(500).json({ error: 'Internal server error during login' });
  }
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

    // Get user metadata from users_app table; auto-provision if missing
    let { data: userData, error: userError } = await supabase
      .from('users_app')
      .select('*')
      .eq('id', sessionData.user.id)
      .maybeSingle();

    if (!userData) {
      const { data: created, error: upsertErr } = await supabaseAdmin
        .from('users_app')
        .upsert({
          id: sessionData.user.id,
          email: sessionData.user.email,
          role: 'client',
          permissions: { tier: 'basic' },
        }, { onConflict: 'id' })
        .select('*')
        .single();
      if (!upsertErr) {
        userData = created;
      }
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
      options: { redirectTo: `${FRONTEND_URL}/auth/new-password?mode=invite` },
    });
    if (linkError) return res.status(400).json({ error: linkError.message });

    const invitedUserId = linkData?.user?.id;
    if (invitedUserId) {
      const { error: upsertErr } = await supabaseAdmin
        .from('users_app')
        .upsert({ id: invitedUserId, email, full_name, company_name, role, permissions });
      if (upsertErr) {
        console.error('users_app upsert error (invite):', upsertErr.message);
      }
    }

    // Send branded email with action_link
    try {
      let actionLink = linkData?.properties?.action_link;
      try {
        const FRONTEND_URL = process.env.FRONTEND_URL;
        const secret = process.env.STATE_TOKEN_SECRET || process.env.SUPABASE_JWT_SECRET || 'dev-secret';
        const state = signState({ purpose: 'invite', email, exp: Date.now() + 60 * 60 * 1000 }, secret);
        const frontendUrl = new URL(`${FRONTEND_URL}/auth/new-password`);
        frontendUrl.searchParams.set('mode', 'invite');
        frontendUrl.searchParams.set('state', state);
        actionLink = frontendUrl.toString();
      } catch (_) {}
      console.log('actionLink', actionLink);
      const { renderInviteEmail } = require('../utils/emailTemplates/invite');
      const html = renderInviteEmail({ actionLink, recipientName: full_name });
      await sendEmail({
        to: email,
        subject: 'You are invited to Scriptiflow',
        text: `Welcome to Scriptiflow! Set your password using this link: ${actionLink}`,
        html,
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
      options: { redirectTo: `${FRONTEND_URL}/auth/new-password?mode=recovery` },
    });
    if (error) {
      // Avoid user enumeration: always return success shape
      await new Promise(r => setTimeout(r, 300));
      return res.json({ status: 'sent' });
    }

    try {
      let actionLink = data?.properties?.action_link;
      try {
        const FRONTEND_URL = process.env.FRONTEND_URL;
        // Attach short-lived HMAC state to mitigate link tampering (10 min)
        const secret = process.env.STATE_TOKEN_SECRET || process.env.SUPABASE_JWT_SECRET || 'dev-secret';
        const state = signState({ purpose: 'recovery', email, exp: Date.now() + 10 * 60 * 1000 }, secret);
        const frontendUrl = new URL(`${FRONTEND_URL}/auth/new-password`);
        frontendUrl.searchParams.set('mode', 'recovery');
        frontendUrl.searchParams.set('state', state);
        actionLink = frontendUrl.toString();
      } catch (_) {}
      console.log('actionLink', actionLink);
      const { renderRecoveryEmail } = require('../utils/emailTemplates/recovery');
      const html = renderRecoveryEmail({ actionLink });
      await sendEmail({
        to: email,
        subject: 'Reset your password',
        text: `Reset your password using this link: ${actionLink}`,
        html,
      });
    } catch (e) {
      console.log('Recovery email skipped/failed:', e?.message || e);
    }
    // Always return success regardless of whether email exists
    await new Promise(r => setTimeout(r, 150));
    return res.json({ status: 'sent' });
  } catch (err) {
    // Do not leak errors for enumeration; return generic
    return res.json({ status: 'sent' });
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
  const { password, mode, state } = req.body || {};
  // Verify state if provided
  try {
    if (state) {
      const secret = process.env.STATE_TOKEN_SECRET || process.env.SUPABASE_JWT_SECRET || 'dev-secret';
      const result = verifyState(state, secret);
      if (!result.valid) return res.status(400).json({ error: 'Invalid or expired state' });
      if (mode && result.payload?.purpose !== mode) return res.status(400).json({ error: 'Invalid state purpose' });
    }
  } catch (_) {}
  // Check strength
  try {
    const { data: me0 } = await supabase.auth.getUser(token);
    const email = me0?.user?.email;
    const { validatePasswordStrengthAsync } = require('../utils/passwordPolicy');
    const strength = await validatePasswordStrengthAsync(password, email);
    if (!strength.valid) return res.status(400).json({ error: strength.message });
  } catch (_) {
    if (!password || password.length < 12) {
      return res.status(400).json({ error: 'Password must be at least 12 characters' });
    }
  }
  try {
    const { error: sessionError } = await supabase.auth.setSession({ access_token: token, refresh_token: refreshToken || null });
    if (sessionError) return res.status(401).json({ error: 'Invalid or expired session' });
    // When coming from invite flow, enforce one-time guard
    if (mode === 'invite') {
      const { data: me, error: whoErr } = await supabase.auth.getUser(token);
      if (whoErr || !me?.user?.id) return res.status(401).json({ error: 'Invalid session' });
      const userId = me.user.id;
      // If password_set_at already set, block re-use
      const { data: prof } = await supabase
        .from('users_app')
        .select('password_set_at')
        .eq('id', userId)
        .maybeSingle();
      if (prof?.password_set_at) {
        return res.status(410).json({ error: 'Invite link already used' });
      }
    }
    const { error: updError } = await supabase.auth.updateUser({ password });
    if (updError) return res.status(400).json({ error: updError.message });
    // Mark password_set_at on first successful set
    try {
      const { data: me2 } = await supabase.auth.getUser(token);
      const userId2 = me2?.user?.id;
      if (userId2) {
        await supabaseAdmin
          .from('users_app')
          .update({ password_set_at: new Date().toISOString() })
          .eq('id', userId2);
        // Invalidate other sessions for safety
        try { await supabaseAdmin.auth.admin.signOut(userId2); } catch (_) {}
      }
    } catch (_) {}
    return res.json({ status: 'password_set' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

module.exports = { login, register, refresh, inviteUser, forgotPassword, setPassword };

// Change password using current session; requires current password verification
async function changePassword(req, res) {
  const authHeader = req.headers.authorization;
  const refreshToken = req.headers['x-refresh-token'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }
  const token = authHeader.split(' ')[1];
  const { current_password, new_password, logout_all } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  try {
    const supabase = require('../config/supabaseClient');
    const supabaseAdmin = require('../config/supabaseAdmin');
    // Ensure session
    const { error: sessionError } = await supabase.auth.setSession({ access_token: token, refresh_token: refreshToken || null });
    if (sessionError) return res.status(401).json({ error: 'Invalid or expired session' });
    const { data: me } = await supabase.auth.getUser(token);
    const userId = me?.user?.id;
    const email = me?.user?.email;
    if (!userId || !email) return res.status(401).json({ error: 'Invalid session' });

    // Re-authenticate by attempting sign-in with current password
    const { data: loginData, error: authErr } = await supabase.auth.signInWithPassword({ email, password: current_password });
    if (authErr || !loginData?.user) return res.status(401).json({ error: 'Current password is incorrect' });

    // Strong password policy and not equal to current
    if (current_password === new_password) {
      return res.status(400).json({ error: 'New password must differ from current password' });
    }
    const { validatePasswordStrengthAsync } = require('../utils/passwordPolicy');
    const strength = await validatePasswordStrengthAsync(new_password, email);
    if (!strength.valid) return res.status(400).json({ error: strength.message });

    // Update to new password
    const { error: updError } = await supabase.auth.updateUser({ password: new_password });
    if (updError) return res.status(400).json({ error: updError.message });

    // Optionally invalidate other sessions
    if (logout_all === true) {
      try {
        await supabaseAdmin.auth.admin.signOut(loginData.user.id);
      } catch (_) {}
    }
    return res.json({ status: 'password_changed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

module.exports.changePassword = changePassword;