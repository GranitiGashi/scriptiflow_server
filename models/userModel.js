const supabase = require('../config/supabaseClient');

async function getUserByEmail(email) {
  const { data, error } = await supabase
    .from('users_app')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function insertUserRecord(user) {
  const { error } = await supabase.from('users_app').insert([user]);
  if (error) throw new Error(error.message);
}

module.exports = { getUserByEmail, insertUserRecord };
