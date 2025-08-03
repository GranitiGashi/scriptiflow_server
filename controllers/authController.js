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

  try {
    const record = await getUserByEmail(email);
    if (!record || !(await verifyPassword(password, record.password_hash)))
      return res.status(401).json({ detail: 'Invalid credentials' });

    const userData = {
      sub: email,
      user_id: record.id,
      role: record.role,
      full_name: record.full_name,
      company_name: record.company_name,
      permissions: record.permissions || {}
    };

    const token = createToken(userData);

    return res.status(200).json({
      status: 'success',
      access_token: token,
      token_type: 'bearer',
      user: userData
    });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
}

module.exports = { login, register };
