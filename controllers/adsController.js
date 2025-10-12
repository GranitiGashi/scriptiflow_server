const axios = require('axios');
const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const stripe = require('../utils/stripeClient');
const openai = require('../utils/openaiClient');
const { getFacebookUserToken } = require('../models/socialTokenModel');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

const { getUserFromRequest } = require('../utils/authUser');

async function getSupabaseUser(req) {
  const { user, accessToken, error } = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
  if (error) return { error };
  return { user, accessToken };
}

/**
 * Helpers: map legacy objectives -> new OUTCOME_* campaign objectives,
 * and map campaign objectives -> valid optimization goals acceptable by Facebook.
 */
const VALID_OPTIMIZATION_GOALS = new Set([
  "NONE","APP_INSTALLS","AD_RECALL_LIFT","ENGAGED_USERS","EVENT_RESPONSES",
  "IMPRESSIONS","LEAD_GENERATION","QUALITY_LEAD","LINK_CLICKS","OFFSITE_CONVERSIONS",
  "PAGE_LIKES","POST_ENGAGEMENT","QUALITY_CALL","REACH","LANDING_PAGE_VIEWS",
  "VISIT_INSTAGRAM_PROFILE","VALUE","THRUPLAY","DERIVED_EVENTS",
  "APP_INSTALLS_AND_OFFSITE_CONVERSIONS","CONVERSATIONS","IN_APP_VALUE",
  "MESSAGING_PURCHASE_CONVERSION","SUBSCRIBERS","REMINDERS_SET",
  "MEANINGFUL_CALL_ATTEMPT","PROFILE_VISIT","PROFILE_AND_PAGE_ENGAGEMENT",
  "ADVERTISER_SILOED_VALUE","AUTOMATIC_OBJECTIVE","MESSAGING_APPOINTMENT_CONVERSION"
]);

function mapCampaignObjective(obj) {
  if (!obj) return 'OUTCOME_TRAFFIC';
  const key = String(obj).toUpperCase();
  // already an OUTCOME_* value?
  if (key.startsWith('OUTCOME_')) return key;
  switch (key) {
    case 'LINK_CLICKS':
    case 'TRAFFIC':
      return 'OUTCOME_TRAFFIC';
    case 'CONVERSIONS':
    case 'SALES':
      return 'OUTCOME_SALES';
    case 'LEAD_GENERATION':
    case 'LEADS':
      return 'OUTCOME_LEADS';
    case 'POST_ENGAGEMENT':
    case 'ENGAGEMENT':
      return 'OUTCOME_ENGAGEMENT';
    case 'AWARENESS':
    case 'BRAND_AWARENESS':
      return 'OUTCOME_AWARENESS';
    case 'APP_INSTALLS':
      return 'OUTCOME_APP_PROMOTION';
    default:
      return 'OUTCOME_TRAFFIC';
  }
}

function mapOptimizationGoal(campaignObjective) {
  // campaignObjective is expected to be an OUTCOME_* value
  switch (campaignObjective) {
    case 'OUTCOME_AWARENESS':
      return 'REACH';
    case 'OUTCOME_TRAFFIC':
      // prefer LINK_CLICKS for traffic/outcome_traffic
      return 'LINK_CLICKS';
    case 'OUTCOME_ENGAGEMENT':
      return 'POST_ENGAGEMENT';
    case 'OUTCOME_LEADS':
      return 'LEAD_GENERATION';
    case 'OUTCOME_SALES':
      return 'OFFSITE_CONVERSIONS';
    case 'OUTCOME_APP_PROMOTION':
      return 'APP_INSTALLS';
    default:
      return 'IMPRESSIONS';
  }
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

    const prompt = `You are a senior performance marketer specializing in automotive. Create a concrete Facebook ads plan (strict JSON) for the car below. Tailor targeting to the dealership location, using a radius geo-target if lat/lon are available, otherwise use the country. Use specific copy based on specs (mileage, fuel, power, gearbox), and a compelling CTA.

Strictly return JSON with these fields only:
{
  "objective": "OUTCOME_TRAFFIC" | "OUTCOME_LEADS" | "OUTCOME_SALES",
  "target_audience": {
    "age": "min-max",
    "gender": "male" | "female" | "all"
  },
  "placements": ["facebook_feeds","instagram_feeds","facebook_reels"],
  "duration_days": number (3-30),
  "daily_budget_cents": number (1000-10000),
  "special_ad_categories": ["none"],
  "creative": {
    "primary_text": string,
    "headline": string,
    "description": string,
    "CTA": "LEARN_MORE" | "CONTACT_US" | "CALL_NOW"
  },
  "campaign_name": string,
  "adset_name": string,
  "ad_name": string
}

Inputs:
- Car: ${JSON.stringify(car)}
- Preferred objective: ${objective || 'TRAFFIC'}
- Country: ${country}
- Language: ${language}

Rules:
- Avoid generic copy; mention make/model, first registration, mileage, fuel, gearbox, and an offer angle when possible.
- If car.dealerLat & car.dealerLon exist (frontend will set), plan for radius targeting ~25km (frontend will implement). Otherwise keep country-based.
- Keep daily_budget_cents realistic (e.g., 1000-5000) unless specs suggest otherwise.
- Output must be valid JSON only, no comments, no code fences.`;

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

    // Create internal campaign record before charge & FB calls
    // Compute timing
    const internal_campaign_start = plan.start_time || new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const internal_campaign_end = plan.end_time || new Date(Date.now() + (plan.duration_days || 7) * 86400000).toISOString();

    // Insert campaign
    let campaignId = null;
    try {
      const { data: campRow, error: campErr } = await supabaseAdmin
        .from('ad_campaigns')
        .insert([
          {
            user_id: user.id,
            facebook_page_id: creative?.page_id || null,
            stripe_customer_id: null,
            start_time: internal_campaign_start,
            end_time: internal_campaign_end,
            commission_percent: 0,
            retry_count: 0,
            ad_account_id,
            call_to_action_link: creative?.url || null,
            body: creative?.primary_text || null,
            title: creative?.headline || null,
            name: creative?.campaign_name || `Car Campaign ${new Date().toISOString()}`,
            status: 'CREATING',
          },
        ])
        .select('id')
        .single();
      if (campErr) {
        console.error('ad_campaigns insert error:', campErr.message);
      } else {
        campaignId = campRow.id;
      }
    } catch (dbErr) {
      console.error('ad_campaigns insert exception:', dbErr);
    }

    // Insert single ad row for this campaign
    let campaignAdId = null;
    try {
      const lifetimeBudgetCents = (plan.daily_budget_cents || 0) * (plan.duration_days || 1);
      const placements = Array.isArray(plan.placements) ? plan.placements : [];
      const publisher_platforms = Array.from(
        new Set(
          placements.map((pl) => (pl.startsWith('instagram_') ? 'instagram' : pl.startsWith('facebook_') ? 'facebook' : null)).filter(Boolean)
        )
      );
      const facebook_positions = placements
        .filter((pl) => pl.startsWith('facebook_'))
        .map((pl) => (pl.endsWith('feeds') ? 'feed' : pl.replace('facebook_', '')));
      const instagram_positions = placements
        .filter((pl) => pl.startsWith('instagram_'))
        .map((pl) => (pl.endsWith('feeds') ? 'feed' : pl.replace('instagram_', '')));

      const geo = plan?.targeting?.geo_locations || {};
      const locations = Array.isArray(geo?.custom_locations)
        ? geo.custom_locations.map((l) => ({ latitude: l.latitude, longitude: l.longitude, radius: l.radius, distance_unit: l.distance_unit }))
        : [];

      if (campaignId) {
        const { data: adRow, error: adErr } = await supabaseAdmin
          .from('ad_campaign_ads')
          .insert([
            {
              campaign_id: campaignId,
              lifetime_budget_cents: lifetimeBudgetCents,
              publisher_platforms,
              facebook_positions,
              instagram_positions,
              locations,
              template_image_url: creative?.image_url || null,
            },
          ])
          .select('id')
          .single();
        if (adErr) {
          console.error('ad_campaign_ads insert error:', adErr.message);
        } else {
          campaignAdId = adRow.id;
        }
      }
    } catch (dbErr) {
      console.error('ad_campaign_ads insert exception:', dbErr);
    }

    // Validate payment method before running FB APIs (but don't charge yet)
    let pmRow = null;
    if (total_charge > 0) {
      const pmRes = await supabase
        .from('user_payment_methods')
        .select('stripe_customer_id, payment_method_id')
        .eq('user_id', user.id)
        .maybeSingle();
      pmRow = pmRes.data || null;
      if (!pmRow?.stripe_customer_id || !pmRow?.payment_method_id) {
        return res.status(400).json({ error: 'No default payment method on file. Please add a payment method first.' });
      }
      try {
        await stripe.customers.retrieve(pmRow.stripe_customer_id);
      } catch (err) {
        return res.status(400).json({ error: 'Payment method invalid. Please re-add your payment method.' });
      }
    }

    const tokenRecord = await getFacebookUserToken(user.id);
    if (!tokenRecord?.access_token) {
      return res.status(400).json({ error: 'Facebook user token not found. Please reconnect Facebook.' });
    }
    const access_token = tokenRecord.access_token;

    // Normalize special ad categories early
    let specialAdCategories = plan.special_ad_categories || [];
    if (!Array.isArray(specialAdCategories)) specialAdCategories = [specialAdCategories].filter(Boolean);
    specialAdCategories = specialAdCategories.map((c) => String(c || '').toUpperCase());
    if (specialAdCategories.length === 1 && (specialAdCategories[0] === 'NONE' || specialAdCategories[0] === 'NO' || specialAdCategories[0] === 'N/A')) {
      specialAdCategories = [];
    }
    const allowedCats = new Set(['CREDIT','EMPLOYMENT','HOUSING','ISSUES_ELECTIONS_POLITICS','ONLINE_GAMBLING_AND_GAMING','OTHER']);
    specialAdCategories = specialAdCategories.filter((c) => allowedCats.has(c));

    // Map & validate campaign objective (use OUTCOME_*)
    const campaignObjective = mapCampaignObjective(plan.objective);
    // Map optimization goal from campaign objective and validate
    const optimizationGoal = mapOptimizationGoal(campaignObjective);
    if (!VALID_OPTIMIZATION_GOALS.has(optimizationGoal)) {
      return res.status(400).json({ error: `Mapped optimization_goal "${optimizationGoal}" is not valid for this FB API version.` });
    }

    // 1) Create campaign
    const campaignRes = await axios.post(`${GRAPH_BASE}/${ad_account_id}/campaigns`, null, {
      params: {
        name: creative?.campaign_name || `Car Campaign ${new Date().toISOString()}`,
        objective: campaignObjective,
        status: 'PAUSED',
        special_ad_categories: JSON.stringify(specialAdCategories),
        access_token,
      },
    });
    const campaign_id = campaignRes.data.id;

    // Update internal campaign with FB campaign id
    if (campaignId) {
      await supabaseAdmin
        .from('ad_campaigns')
        .update({ facebook_campaign_id: campaign_id, status: 'CAMPAIGN_CREATED', updated_at: new Date().toISOString() })
        .eq('id', campaignId);
    }

    // 2) Create ad set
    const adset_start_time = plan.start_time || new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const adset_end_time = plan.end_time || new Date(Date.now() + (plan.duration_days || 7) * 86400000).toISOString();
    const daily_budget = plan.daily_budget_cents || 1000; // in cents
    const targeting = plan.targeting || { geo_locations: { countries: [plan.country || 'DE'] } };
    // Ensure Advantage Audience flag is explicitly set per FB requirement
    // Use plan.advantage_audience (boolean) if provided, else preserve inbound targeting_automation, else default to 0 (disabled)
    let effectiveTargeting = { ...targeting };
    const hasAutomation = typeof targeting?.targeting_automation?.advantage_audience !== 'undefined';
    if (typeof plan?.advantage_audience === 'boolean') {
      effectiveTargeting = {
        ...effectiveTargeting,
        targeting_automation: { advantage_audience: plan.advantage_audience ? 1 : 0 },
      };
    } else if (!hasAutomation) {
      effectiveTargeting = {
        ...effectiveTargeting,
        targeting_automation: { advantage_audience: 0 },
      };
    }

    console.log('Special ad categories (normalized):', specialAdCategories);
    console.log('Using campaignObjective:', campaignObjective, 'optimizationGoal:', optimizationGoal);

    // Bid strategy mapping: support lowest cost with/without cap
    let bidStrategy = undefined;
    let bidAmountParam = undefined;
    const planBidStrategy = String(plan?.bid_strategy || '').toUpperCase();
    const planBidAmount = Number.isFinite(plan?.bid_amount) ? Number(plan.bid_amount) : undefined;
    if (planBidStrategy) {
      if (planBidStrategy === 'LOWEST_COST') {
        if (planBidAmount && planBidAmount > 0) {
          bidStrategy = 'LOWEST_COST_WITH_BID_CAP';
          bidAmountParam = planBidAmount;
        } else {
          bidStrategy = 'LOWEST_COST_WITHOUT_CAP';
        }
      } else if (planBidStrategy === 'LOWEST_COST_WITH_BID_CAP') {
        bidStrategy = 'LOWEST_COST_WITH_BID_CAP';
        if (planBidAmount && planBidAmount > 0) bidAmountParam = planBidAmount; else {
          return res.status(400).json({ error: 'bid_amount is required when using LOWEST_COST_WITH_BID_CAP' });
        }
      } else if (planBidStrategy === 'LOWEST_COST_WITHOUT_CAP') {
        bidStrategy = 'LOWEST_COST_WITHOUT_CAP';
      } else if (planBidStrategy === 'COST_CAP') {
        // Basic support: require bid_amount, otherwise FB will error
        bidStrategy = 'COST_CAP';
        if (planBidAmount && planBidAmount > 0) bidAmountParam = planBidAmount; else {
          return res.status(400).json({ error: 'bid_amount is required when using COST_CAP' });
        }
      }
    }

    const adsetParams = {
      name: creative?.adset_name || 'Car Ad Set',
      campaign_id,
      billing_event: 'IMPRESSIONS',
      optimization_goal: optimizationGoal, // <- valid mapped value
      daily_budget,
      start_time: adset_start_time,
      end_time: adset_end_time,
      targeting: JSON.stringify(effectiveTargeting),
      status: 'PAUSED',
      access_token,
    };
    // EU DSA compliance: indicate beneficiary (benefiting org/person) and payor (paying org/person)
    // Try to infer from user metadata, allow plan overrides
    let beneficiary = (plan && (plan.beneficiary || plan.dsa_beneficiary)) || null;
    let payor = (plan && (plan.payor || plan.payer || plan.dsa_payor)) || null;
    try {
      const { data: appUser } = await supabaseAdmin
        .from('users_app')
        .select('company_name, full_name, email')
        .eq('id', user.id)
        .maybeSingle();
      if (!beneficiary) beneficiary = appUser?.company_name || appUser?.full_name || appUser?.email || null;
      if (!payor) payor = appUser?.company_name || appUser?.full_name || appUser?.email || null;
    } catch (_) {}
    if (beneficiary) Object.assign(adsetParams, { dsa_beneficiary: beneficiary });
    if (payor) Object.assign(adsetParams, { dsa_payor: payor });
    if (bidStrategy) Object.assign(adsetParams, { bid_strategy: bidStrategy });
    if (bidAmountParam) Object.assign(adsetParams, { bid_amount: bidAmountParam });

    const adsetRes = await axios.post(`${GRAPH_BASE}/${ad_account_id}/adsets`, null, { params: adsetParams });
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

    // Update internal ad row with FB ids
    if (campaignAdId) {
      await supabaseAdmin
        .from('ad_campaign_ads')
        .update({ facebook_ad_set_id: adset_id, facebook_ad_id: ad_id, updated_at: new Date().toISOString() })
        .eq('id', campaignAdId);
    }

    // 5) Charge user only after all FB entities are successfully created
    if (total_charge > 0 && pmRow) {
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

      // Store campaign payment record for tracking (legacy table)
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

      // Update internal campaign status
      if (campaignId) {
        await supabaseAdmin
          .from('ad_campaigns')
          .update({ status: 'PAID' })
          .eq('id', campaignId);
      }
    }

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

    // Persist insights if we can map to our campaign
    if (entity_type === 'campaign') {
      try {
        const { data: camp } = await supabaseAdmin
          .from('ad_campaigns')
          .select('id')
          .eq('facebook_campaign_id', entity_id)
          .maybeSingle();
        if (camp?.id) {
          await supabaseAdmin
            .from('ad_campaign_insights')
            .insert([{ campaign_id: camp.id, payload: data, fetched_at: new Date().toISOString() }]);
        }
      } catch (e) {
        console.error('Persist insight error:', e?.message || e);
      }
    }

    res.json(data);
  } catch (err) {
    console.error('getInsights error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch insights' });
  }
};
