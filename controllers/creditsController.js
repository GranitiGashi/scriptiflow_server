const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { getUserFromRequest } = require('../utils/authUser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICE_PER_IMAGE_MILLI = parseInt(process.env.CREDITS_PRICE_PER_IMAGE_MILLI || '250', 10); // 0.25€ default

exports.getBalance = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const { data } = await supabase
      .from('user_credits')
      .select('balance_milli')
      .eq('user_id', userId)
      .maybeSingle();
    res.json({ balance_milli: data?.balance_milli || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed' });
  }
};

exports.topUp = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const { amount_eur } = req.body || {};
    if (!amount_eur || amount_eur <= 0) return res.status(400).json({ error: 'amount_eur required' });

    const { data: pmRow } = await supabase
      .from('user_payment_methods')
      .select('stripe_customer_id, payment_method_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (!pmRow?.stripe_customer_id || !pmRow?.payment_method_id) return res.status(400).json({ error: 'No saved card' });

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount_eur * 100),
      currency: 'eur',
      customer: pmRow.stripe_customer_id,
      payment_method: pmRow.payment_method_id,
      confirm: true,
      off_session: true,
      description: 'Credits top-up',
    });

    const creditMilli = Math.round(amount_eur * 1000);
    await supabaseAdmin.rpc('increment_credits', { p_user_id: userId, p_delta_milli: creditMilli });
    res.json({ ok: true, balance_added_milli: creditMilli });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to top up' });
  }
};

// Charge-on-completion fallback: deduct per successful image
exports.onImageProcessed = async ({ userId, jobId }) => {
  try {
    const delta = -PRICE_PER_IMAGE_MILLI;
    await supabaseAdmin.from('user_credit_transactions').insert({ user_id: userId, delta_milli: delta, reason: 'image_processed', job_id: jobId });
    await supabaseAdmin.rpc('increment_credits', { p_user_id: userId, p_delta_milli: delta });
  } catch (e) {}
};


