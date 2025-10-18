const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { getUserFromRequest } = require('../utils/authUser');

function buildContactFilters({ q, source, hasEmail, hasPhone, includeDeleted }) {
  const filters = [];
  if (q && q.trim()) filters.push({ type: 'ilike_any', cols: ['first_name','last_name','email','phone'], value: `%${q.trim()}%` });
  if (source) filters.push({ type: 'eq', col: 'source', value: source });
  if (hasEmail === 'true') filters.push({ type: 'not', col: 'email', op: 'is', value: null });
  if (hasPhone === 'true') filters.push({ type: 'not', col: 'phone', op: 'is', value: null });
  if (includeDeleted !== 'true') filters.push({ type: 'is', col: 'deleted_at', value: null });
  return filters;
}

exports.list = async (req, res) => {
  try {
    const auth = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (auth.error) return res.status(auth.error.status || 401).json({ error: auth.error.message });
    const user = auth.user;
    const { q, source, hasEmail, hasPhone, includeDeleted, limit = 50, offset = 0 } = req.query;
    let query = supabase
      .from('crm_contacts')
      .select('id, first_name, last_name, email, phone, source, created_at, updated_at, deleted_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    
    // Apply filters
    if (source) query = query.eq('source', source);
    if (hasEmail === 'true') query = query.not('email', 'is', null).neq('email', '');
    if (hasPhone === 'true') query = query.not('phone', 'is', null).neq('phone', '');
    if (includeDeleted !== 'true') query = query.is('deleted_at', null);
    
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    let rows = data || [];
    
    // Apply text search filter locally (for OR logic across multiple columns)
    if (q && q.trim()) {
      const qq = q.trim().toLowerCase();
      rows = rows.filter(r => [r.first_name, r.last_name, r.email, r.phone].some(v => (v || '').toLowerCase().includes(qq)));
    }
    
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to load contacts' });
  }
};

exports.exportAll = async (req, res) => {
  try {
    const auth = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (auth.error) return res.status(auth.error.status || 401).json({ error: auth.error.message });
    const user = auth.user;
    const { data, error } = await supabase
      .from('crm_contacts')
      .select('first_name,last_name,email,phone,source,created_at')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5000);
    if (error) return res.status(500).json({ error: error.message });
    const rows = data || [];
    const header = ['First Name','Last Name','Email','Phone','Source','Created At'];
    const csv = [header.join(',')].concat(rows.map(r => [r.first_name||'', r.last_name||'', r.email||'', r.phone||'', r.source||'', r.created_at||''].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','))).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    return res.send(csv);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to export' });
  }
};

exports.bulkDelete = async (req, res) => {
  try {
    const auth = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (auth.error) return res.status(auth.error.status || 401).json({ error: auth.error.message });
    const user = auth.user;
    const { ids = [], hard = false } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
    if (hard) {
      const { error } = await supabaseAdmin.from('crm_contacts').delete().eq('user_id', user.id).in('id', ids);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ deleted: ids.length, hard: true });
    }
    const { error } = await supabaseAdmin.from('crm_contacts').update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('user_id', user.id).in('id', ids);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ deleted: ids.length, hard: false });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to delete' });
  }
};

exports.getDetail = async (req, res) => {
  try {
    const auth = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (auth.error) return res.status(auth.error.status || 401).json({ error: auth.error.message });
    const user = auth.user;
    const { id } = req.params;
    // Contact core
    const { data: contact } = await supabase
      .from('crm_contacts')
      .select('id, first_name, last_name, email, phone, source, created_at')
      .eq('user_id', user.id)
      .eq('id', id)
      .maybeSingle();
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    // Notes
    const { data: notes } = await supabase
      .from('contact_notes')
      .select('id, body, created_at')
      .eq('user_id', user.id)
      .eq('contact_id', id)
      .order('created_at', { ascending: false });
    // Upcoming + history events
    const now = new Date().toISOString();
    const { data: upcoming } = await supabase
      .from('calendar_events')
      .select('id, title, start_time, end_time, car_mobile_de_id')
      .eq('user_id', user.id)
      .eq('contact_id', id)
      .is('deleted_at', null)
      .gte('start_time', now)
      .order('start_time', { ascending: true })
      .limit(10);
    const { data: history } = await supabase
      .from('calendar_events')
      .select('id, title, start_time, end_time, car_mobile_de_id')
      .eq('user_id', user.id)
      .eq('contact_id', id)
      .is('deleted_at', null)
      .lt('start_time', now)
      .order('start_time', { ascending: false })
      .limit(20);
    // Email threads (basic by from_email match)
    let emails = [];
    if (contact.email) {
      const { data } = await supabase
        .from('email_leads')
        .select('id, provider, subject, snippet, received_at, thread_id')
        .eq('user_id', user.id)
        .ilike('from_email', `%${contact.email}%`)
        .order('received_at', { ascending: false })
        .limit(50);
      emails = data || [];
    }
    return res.json({ contact, notes: notes || [], upcoming: upcoming || [], history: history || [], emails });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to load contact detail' });
  }
};

exports.addNote = async (req, res) => {
  try {
    const auth = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (auth.error) return res.status(auth.error.status || 401).json({ error: auth.error.message });
    const user = auth.user;
    const { id } = req.params;
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: 'Note body required' });
    const { error } = await supabaseAdmin.from('contact_notes').insert({ user_id: user.id, contact_id: id, body });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to add note' });
  }
};

exports.update = async (req, res) => {
  try {
    const auth = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (auth.error) return res.status(auth.error.status || 401).json({ error: auth.error.message });
    const user = auth.user;
    const { id } = req.params;
    const { first_name, last_name, email, phone, source } = req.body || {};
    
    // Build update object with only provided fields
    const updates = { updated_at: new Date().toISOString() };
    if (first_name !== undefined) updates.first_name = first_name;
    if (last_name !== undefined) updates.last_name = last_name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (source !== undefined) updates.source = source;
    
    const { data, error } = await supabaseAdmin
      .from('crm_contacts')
      .update(updates)
      .eq('user_id', user.id)
      .eq('id', id)
      .select()
      .single();
      
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Contact not found' });
    
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to update contact' });
  }
};


