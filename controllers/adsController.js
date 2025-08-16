const axios = require('axios');
const supabase = require('../config/supabaseClient');
const stripe = require('../utils/stripeClient');
const openai = require('../utils/openaiClient');
const { getFacebookUserToken } = require('../models/socialTokenModel');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

async function getSupabaseUser(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return { error: { status: 401, message: 'Unauthorized: Missing token' } };
  }
  const token = auth.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { error: { status: 401, message: 'Unauthorized: Invalid token' } };
  return { user, accessToken: token };
}

exports.listAdAccounts = async (req, res) => {
  try {
    const { user, error } = await getSupabaseUser(req);
    if (error) return res.status(error.status).json({ error: error.message });

    const tokenRecord = await getFacebookUserToken(user.id);
    if (!tokenRecord?.access_token) {
      return res.status(400).json({ error: 'Facebook user token not found. Please reconnect Facebook.' });
    }

    const { data } = await axios.get(`${GRAPH_BASE}/me/adaccounts`, {
      params: { fields: 'id,name,currency,account_status', access_token: tokenRecord.access_token },
    });
    res.json(data);
  } catch (err) {
    console.error('listAdAccounts error:', err.response?.data || err.message);
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

    // Ensure user has a default payment method with us (optional: take a service fee)
    if (charge_amount_cents && charge_amount_cents > 0) {
      // Lookup Stripe customer + payment method
      const { data: pmRow } = await supabase
        .from('user_payment_methods')
        .select('stripe_customer_id, payment_method_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!pmRow?.stripe_customer_id || !pmRow?.payment_method_id) {
        return res.status(400).json({ error: 'No default payment method on file' });
      }
      // Create a one-time charge
      await stripe.paymentIntents.create({
        amount: charge_amount_cents,
        currency: 'eur',
        customer: pmRow.stripe_customer_id,
        payment_method: pmRow.payment_method_id,
        confirm: true,
        off_session: true,
        description: 'Ad campaign setup/service fee',
      });
    }

    const tokenRecord = await getFacebookUserToken(user.id);
    if (!tokenRecord?.access_token) {
      return res.status(400).json({ error: 'Facebook user token not found. Please reconnect Facebook.' });
    }
    const access_token = tokenRecord.access_token;

    // 1) Create campaign
    const campaignRes = await axios.post(`${GRAPH_BASE}/act_${ad_account_id}/campaigns`, null, {
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

    const adsetRes = await axios.post(`${GRAPH_BASE}/act_${ad_account_id}/adsets`, null, {
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
    const creativeRes = await axios.post(`${GRAPH_BASE}/act_${ad_account_id}/adcreatives`, null, {
      params: {
        name: creative?.name || 'Car Creative',
        object_story_spec: JSON.stringify({
          page_id: creative.page_id,
          link_data: {
            message: creative.primary_text,
            link: creative.url,
            caption: creative.headline,
            description: creative.description,
            call_to_action: { type: creative.cta || 'LEARN_MORE', value: { link: creative.url } },
            picture: creative.image_url,
          },
        }),
        access_token,
      },
    });
    const creative_id = creativeRes.data.id;

    // 4) Create ad
    const adRes = await axios.post(`${GRAPH_BASE}/act_${ad_account_id}/ads`, null, {
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
    res.status(500).json({ error: 'Failed to create campaign' });
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


