const axios = require('axios');
const supabase = require('../config/supabaseClient');
const stripe = require('../utils/stripeClient');
const openai = require('../utils/openaiClient');
const { getFacebookUserToken } = require('../models/socialTokenModel');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

async function getSupabaseUser(req) {
  console.log('🔍 [getSupabaseUser] Starting authentication check...');
  
  const auth = req.headers.authorization;
  console.log('🔍 [getSupabaseUser] Auth header present:', !!auth);
  
  if (!auth || !auth.startsWith('Bearer ')) {
    console.log('❌ [getSupabaseUser] Missing or invalid authorization header');
    return { error: { status: 401, message: 'Unauthorized: Missing token' } };
  }
  
  const token = auth.split(' ')[1];
  console.log('🔍 [getSupabaseUser] Token extracted, length:', token?.length || 0);
  
  const { data: { user }, error } = await supabase.auth.getUser(token);
  console.log('🔍 [getSupabaseUser] Supabase getUser result:', {
    user: user ? { id: user.id, email: user.email } : null,
    error: error?.message || null
  });
  
  if (error || !user) {
    console.log('❌ [getSupabaseUser] Failed to get user from Supabase:', error?.message);
    return { error: { status: 401, message: 'Unauthorized: Invalid token' } };
  }
  
  // Ensure RLS policies see this user for subsequent queries
  try {
    const refreshToken = req.headers['x-refresh-token'] || null;
    console.log('🔍 [getSupabaseUser] Setting session with refresh token present:', !!refreshToken);
    await supabase.auth.setSession({ access_token: token, refresh_token: refreshToken });
  } catch (sessionError) {
    console.log('⚠️ [getSupabaseUser] Session setup failed (proceeding anyway):', sessionError.message);
  }
  
  console.log('✅ [getSupabaseUser] Authentication successful for user:', user.id);
  return { user, accessToken: token };
}

// DEPRECATED: In agency model, we use agency ad accounts instead of client ad accounts
exports.listAdAccounts = async (req, res) => {
  console.log('🚀 [listAdAccounts] Redirecting to agency ad accounts...');
  
  try {
    const { user, error } = await getSupabaseUser(req);
    if (error) return res.status(error.status).json({ error: error.message });

    // Return agency ad accounts with full act_ prefix
    const AGENCY_AD_ACCOUNTS = [
      {
        id: 'act_2830100050563421',
        name: 'Agency Account 1',
        currency: 'EUR',
        account_status: 1
      },
      {
        id: process.env.AGENCY_AD_ACCOUNT_2 || 'act_YOUR_AD_ACCOUNT_2', 
        name: 'Agency Account 2',
        currency: 'EUR',
        account_status: 1
      }
    ];
    
    res.json({ 
      data: AGENCY_AD_ACCOUNTS,
      message: 'Using agency ad accounts for campaign creation'
    });
  } catch (err) {
    console.error('❌ [listAdAccounts] Error occurred:', err.message);
    res.status(500).json({ error: 'Failed to list ad accounts' });
  }
};

exports.recommendAdPlan = async (req, res) => {
  try {
    const { user, error } = await getSupabaseUser(req);
    if (error) return res.status(error.status).json({ error: error.message });

    const { car, objective, country = 'DE', language = 'de' } = req.body;
    if (!car || !car.title) return res.status(400).json({ error: 'Missing car payload' });

    const prompt = `You are an ads strategist for car dealerships. Given this car listing, propose: objective (Traffic/Leads/Messages), target audience (interests, age, gender, radius around location), placements (FB/IG feeds, reels), recommended duration (days), daily budget (in EUR), and ad creative: primary text, headline, description, CTA. Be concise JSON.
Car: ${JSON.stringify(car)}
Preferred objective: ${objective || 'auto'}
Country: ${country}
Language: ${language}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Return strictly valid JSON only. Do not include code fences.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
    });

    let proposal;
    try {
      let content = completion.choices?.[0]?.message?.content || '';
      content = content.trim();
      // Strip code fences if present
      if (content.startsWith('```')) {
        // Remove leading ```[lang]? and trailing ```
        content = content.replace(/^```[a-zA-Z]*\s*/m, '').replace(/\s*```$/m, '').trim();
      }
      // Fallback: extract first JSON object
      if (!(content.startsWith('{') || content.startsWith('['))) {
        const firstBrace = content.indexOf('{');
        const lastBrace = content.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          content = content.slice(firstBrace, lastBrace + 1);
        }
      }
      proposal = JSON.parse(content);
    } catch (e) {
      return res.status(500).json({ error: 'AI returned invalid JSON' });
    }

    res.json({ proposal });
  } catch (err) {
    console.error('recommendAdPlan error:', err.message);
    res.status(500).json({ error: 'Failed to generate recommendation' });
  }
};

exports.createCampaign = async (req, res) => {
  try {
    const { user, error } = await getSupabaseUser(req);
    if (error) return res.status(error.status).json({ error: error.message });

    const { ad_account_id, plan, creative, charge_amount_cents } = req.body;
    if (!ad_account_id || !plan || !creative) return res.status(400).json({ error: 'Missing ad_account_id, plan, or creative' });

    // AGENCY MODEL: Collect full ad spend + service fee from client
    const { total_budget_cents, service_fee_cents, campaign_duration_days = 7 } = req.body;
    
    if (!total_budget_cents || total_budget_cents <= 0) {
      return res.status(400).json({ error: 'Total campaign budget is required' });
    }

    // Calculate total amount to charge client (ad spend + service fee)
    const total_charge = total_budget_cents + (service_fee_cents || 0);

    if (total_charge > 0) {
      // Lookup Stripe customer + payment method
      const { data: pmRow } = await supabase
        .from('user_payment_methods')
        .select('stripe_customer_id, payment_method_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!pmRow?.stripe_customer_id || !pmRow?.payment_method_id) {
        return res.status(400).json({ error: 'No default payment method on file. Please add a payment method first.' });
      }

      // Validate customer exists in current Stripe environment
      try {
        await stripe.customers.retrieve(pmRow.stripe_customer_id);
      } catch (err) {
        return res.status(400).json({ error: 'Payment method invalid. Please re-add your payment method.' });
      }

      // Charge client for full amount (ad spend + service fee)
      const paymentIntent = await stripe.paymentIntents.create({
        amount: total_charge,
        currency: 'eur',
        customer: pmRow.stripe_customer_id,
        payment_method: pmRow.payment_method_id,
        confirm: true,
        off_session: true,
        description: `Ad Campaign: €${(total_budget_cents/100).toFixed(2)} ad spend + €${((service_fee_cents||0)/100).toFixed(2)} service fee`,
        metadata: {
          client_user_id: user.id,
          ad_spend_cents: total_budget_cents,
          service_fee_cents: service_fee_cents || 0,
          campaign_duration_days
        }
      });

      // Store campaign payment record for tracking
      await supabase.from('campaign_payments').insert({
        user_id: user.id,
        payment_intent_id: paymentIntent.id,
        total_amount_cents: total_charge,
        ad_spend_cents: total_budget_cents,
        service_fee_cents: service_fee_cents || 0,
        campaign_duration_days,
        status: 'paid',
        created_at: new Date().toISOString()
      });
    }

    const tokenRecord = await getFacebookUserToken(user.id);
    if (!tokenRecord?.access_token) {
      return res.status(400).json({ error: 'Facebook user token not found. Please reconnect Facebook.' });
    }
    const access_token = tokenRecord.access_token;

    // 1) Create campaign
    // Use ad_account_id directly (should already include act_ prefix)
    const campaignRes = await axios.post(`${GRAPH_BASE}/${ad_account_id}/campaigns`, null, {
      params: {
        name: creative?.campaign_name || `Car Campaign ${new Date().toISOString()}`,
        objective: plan.objective || 'LINK_CLICKS',
        status: 'PAUSED',
        access_token,
      },
    });
    const campaign_id = campaignRes.data.id;

    // 2) Create ad set
    const start_time = plan.start_time || new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const end_time = plan.end_time || new Date(Date.now() + (plan.duration_days || 7) * 86400000).toISOString();
    const daily_budget = plan.daily_budget_cents || 1000; // in cents
    const targeting = plan.targeting || { geo_locations: { countries: [plan.country || 'DE'] } };

    const adsetRes = await axios.post(`${GRAPH_BASE}/${ad_account_id}/adsets`, null, {
      params: {
        name: creative?.adset_name || 'Car Ad Set',
        campaign_id,
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LINK_CLICKS',
        daily_budget,
        start_time,
        end_time,
        targeting: JSON.stringify(targeting),
        status: 'PAUSED',
        access_token,
      },
    });
    const adset_id = adsetRes.data.id;

    // 3) Create creative (requires an image or video) - assume image url provided
    if (!creative.page_id) {
      return res.status(400).json({ error: 'Facebook Page ID is required for ad creative' });
    }
    if (!creative.image_url) {
      return res.status(400).json({ error: 'Image URL is required for ad creative' });
    }
    if (!creative.url) {
      return res.status(400).json({ error: 'Landing page URL is required for ad creative' });
    }

    const creativeRes = await axios.post(`${GRAPH_BASE}/${ad_account_id}/adcreatives`, null, {
      params: {
        name: creative?.name || 'Car Creative',
        object_story_spec: JSON.stringify({
          page_id: creative.page_id,
          link_data: {
            message: creative.primary_text || 'Check out this amazing car!',
            link: creative.url,
            caption: creative.headline || 'Car for Sale',
            description: creative.description || 'High-quality vehicle available now.',
            call_to_action: { type: creative.cta || 'LEARN_MORE', value: { link: creative.url } },
            picture: creative.image_url,
          },
        }),
        access_token,
      },
    });
    const creative_id = creativeRes.data.id;

    // 4) Create ad
    const adRes = await axios.post(`${GRAPH_BASE}/${ad_account_id}/ads`, null, {
      params: {
        name: creative?.ad_name || 'Car Ad',
        adset_id,
        creative: JSON.stringify({ creative_id }),
        status: 'PAUSED',
        access_token,
      },
    });
    const ad_id = adRes.data.id;

    res.json({ campaign_id, adset_id, creative_id, ad_id });
  } catch (err) {
    console.error('createCampaign error:', err.response?.data || err.message);
    let errorMessage = 'Failed to create campaign';
    
    if (err.response?.data?.error?.message) {
      errorMessage = err.response.data.error.message;
    } else if (err.response?.data?.error) {
      errorMessage = err.response.data.error;
    } else if (err.message) {
      errorMessage = err.message;
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: err.response?.data || null 
    });
  }
};

exports.getInsights = async (req, res) => {
  try {
    const { user, error } = await getSupabaseUser(req);
    if (error) return res.status(error.status).json({ error: error.message });

    const { entity_id, entity_type = 'campaign', date_preset = 'last_7d' } = req.query;
    if (!entity_id) return res.status(400).json({ error: 'Missing entity_id' });

    const tokenRecord = await getFacebookUserToken(user.id);
    if (!tokenRecord?.access_token) {
      return res.status(400).json({ error: 'Facebook user token not found. Please reconnect Facebook.' });
    }
    const access_token = tokenRecord.access_token;

    const fields = 'impressions,reach,clicks,ctr,cpc,spend,unique_clicks,actions';
    const url = `${GRAPH_BASE}/${entity_id}/insights`;
    const { data } = await axios.get(url, { params: { fields, date_preset, access_token } });
    res.json(data);
  } catch (err) {
    console.error('getInsights error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch insights' });
  }
};


