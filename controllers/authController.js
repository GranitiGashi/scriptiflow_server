const { getUserByEmail, insertUserRecord } = require('../models/userModel');
const { hashPassword, verifyPassword } = require('../utils/passwordUtils');
const { createToken } = require('../utils/jwtUtils');
const { v4: uuidv4 } = require('uuid');
const  supabase  = require('../config/supabaseClient')
const { verifyToken } = require('../utils/jwtUtils');

async function register(req, res) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyToken(token);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admins only' });
    }

    const { email, password, full_name, company_name, role = 'user', permissions = {} } = req.body;

    // 1. Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError) {
      console.error('Supabase Auth Error:', authError.message);
      return res.status(400).json({ error: authError.message });
    }

    const userId = authData.user.id;

    // 2. Insert user into users_app table
    const { error: insertError } = await supabase
      .from('users_app')
      .insert([
        {
          id: userId,
          email,
          full_name,
          company_name,
          role,
          permissions
        }
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

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return res.status(401).json({ detail: error.message });
  }

  // get user metadata from your users_app table
  const { data: userData, error: userError } = await supabase
    .from('users_app')
    .select('*')
    .eq('id', data.user.id)
    .single();

  if (userError) {
    return res.status(500).json({ detail: userError.message });
  }

  // create your JWT token here with userData info if needed
  // or return Supabase session tokens

  return res.status(200).json({
    status: 'success',
    session: data.session, // contains access_token etc.
    user: userData,
  });
}

module.exports = { login, register };
