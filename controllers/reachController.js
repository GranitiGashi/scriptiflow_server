const axios = require('axios');
const { getFacebookUserToken } = require('../models/socialTokenModel');
const { getUserFromRequest } = require('../utils/authUser');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

async function getSupabaseUser(req) {
  const { user, accessToken, error } = await getUserFromRequest(req, {
    setSession: true,
    allowRefresh: true,
  });
  if (error) return { error };
  return { user, accessToken };
}

// Get reach estimation from Facebook
exports.getReachEstimate = async (req, res) => {
  try {
    const { user, error } = await getSupabaseUser(req);
    if (error) return res.status(error.status).json({ error: error.message });

    const {
      ad_account_id,
      targeting,
      daily_budget_cents = 2000,
      campaign_duration_days = 7,
    } = req.body;

    if (!ad_account_id) {
      return res.status(400).json({ error: 'Ad account ID is required' });
    }

    // Get Facebook access token
    const tokenRecord = await getFacebookUserToken(user.id);
    if (!tokenRecord?.access_token) {
      return res
        .status(400)
        .json({ error: 'Facebook user token not found. Please reconnect Facebook.' });
    }
    const access_token = tokenRecord.access_token;

    // Default targeting if not provided
    const defaultTargeting = {
      geo_locations: { countries: ['DE'] },
      age_min: 18,
      age_max: 65,
      genders: [1, 2],
      interests: [
        { id: '6003107902433', name: 'Cars' },
        { id: '6003348604581', name: 'Automotive industry' },
      ],
    };

    const finalTargeting = targeting || defaultTargeting;

    // Call new Facebook Delivery Estimate endpoint
    const reachRes = await axios.get(
      `${GRAPH_BASE}/${ad_account_id}/delivery_estimate`,
      {
        params: {
          targeting_spec: JSON.stringify(finalTargeting),
          optimization_goal: 'REACH', // required
          access_token,
        },
      }
    );

    const reachData = reachRes.data?.data?.[0];
    if (!reachData || !reachData.estimate_ready) {
      return res
        .status(400)
        .json({ error: 'Reach estimate not available yet. Try again later.' });
    }

    // Facebook's reach estimate (DAU + MAU)
    const dailyReach = reachData.estimate_dau || 0;
    const monthlyReach = reachData.estimate_mau || 0;
    const avgReach = Math.round((dailyReach + monthlyReach) / 2);

    // Budget calculations
    const totalBudgetCents = daily_budget_cents * campaign_duration_days;
    const totalBudgetEur = totalBudgetCents / 100;

    // Impressions estimate (people see ads 2–3 times)
    const estimatedImpressions = Math.round(avgReach * 2.5);

    // Click estimate (typical CTR 2% for automotive)
    const estimatedCtr = 0.02;
    const estimatedClicks = Math.max(1, Math.round(estimatedImpressions * estimatedCtr));

    // Cost estimates
    const costPerClick = totalBudgetCents / estimatedClicks;
    const costPerThousandImpressions =
      estimatedImpressions > 0
        ? (totalBudgetCents / estimatedImpressions) * 1000
        : 0;

    res.json({
      reach_estimate: {
        daily_reach: dailyReach,
        monthly_reach: monthlyReach,
        avg_reach: avgReach,
      },
      performance_estimates: {
        estimated_impressions: estimatedImpressions,
        estimated_clicks: estimatedClicks,
        estimated_ctr_percent: (estimatedCtr * 100).toFixed(1),
      },
      cost_estimates: {
        total_budget_eur: totalBudgetEur,
        cost_per_click_cents: Math.round(costPerClick),
        cost_per_thousand_impressions_cents: Math.round(costPerThousandImpressions),
        daily_budget_eur: daily_budget_cents / 100,
      },
      campaign_info: {
        duration_days: campaign_duration_days,
        targeting_summary: {
          countries: finalTargeting.geo_locations?.countries || ['DE'],
          age_range: `${finalTargeting.age_min || 18}-${finalTargeting.age_max || 65}`,
          interests_count: finalTargeting.interests?.length || 0,
        },
      },
    });
  } catch (err) {
    console.error('getReachEstimate error:', err.response?.data || err.message);

    let errorMessage = 'Failed to get reach estimate';
    if (err.response?.data?.error?.message) {
      errorMessage = err.response.data.error.message;
    }

    res.status(500).json({
      error: errorMessage,
      details: err.response?.data || null,
    });
  }
};

module.exports = exports;
