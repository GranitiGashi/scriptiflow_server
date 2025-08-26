const axios = require('axios');
const supabase = require('../config/supabaseClient');
const { getFacebookUserToken } = require('../models/socialTokenModel');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

// Agency ad accounts - include full act_ prefix
const AGENCY_AD_ACCOUNTS = [
  {
    id: process.env.AGENCY_AD_ACCOUNT_1 || 'act_2830100050563421',
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

async function getSupabaseUser(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return { error: { status: 401, message: 'Unauthorized: Missing token' } };
  }
  
  const token = auth.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return { error: { status: 401, message: 'Unauthorized: Invalid token' } };
  }
  
  return { user, accessToken: token };
}

// Return agency ad accounts instead of client ad accounts
exports.listAgencyAdAccounts = async (req, res) => {
  try {
    const { user, error } = await getSupabaseUser(req);
    if (error) return res.status(error.status).json({ error: error.message });

    // Return your agency ad accounts
    res.json({ 
      data: AGENCY_AD_ACCOUNTS,
      message: 'Agency ad accounts loaded'
    });
  } catch (err) {
    console.error('listAgencyAdAccounts error:', err.message);
    res.status(500).json({ error: 'Failed to list agency ad accounts' });
  }
};

// Validate that client has given page access
exports.validatePageAccess = async (req, res) => {
  try {
    const { user, error } = await getSupabaseUser(req);
    if (error) return res.status(error.status).json({ error: error.message });

    const { page_id } = req.body;
    if (!page_id) {
      return res.status(400).json({ error: 'Page ID is required' });
    }

    // Get client's Facebook token (for their pages)
    const tokenRecord = await getFacebookUserToken(user.id);
    if (!tokenRecord?.access_token) {
      return res.status(400).json({ error: 'Client Facebook connection not found. Please connect Facebook first.' });
    }

    // Check if we can access this page with our agency permissions
    try {
      const pageRes = await axios.get(`${GRAPH_BASE}/${page_id}`, {
        params: {
          fields: 'id,name,access_token,can_post,tasks',
          access_token: tokenRecord.access_token
        }
      });

      const pageData = pageRes.data;
      
      // Check if we have the necessary permissions
      const hasPostAccess = pageData.can_post;
      const hasAdAccess = pageData.tasks && pageData.tasks.includes('ADVERTISE');

      res.json({
        page_id: pageData.id,
        page_name: pageData.name,
        has_post_access: hasPostAccess,
        has_ad_access: hasAdAccess,
        permissions_valid: hasPostAccess && hasAdAccess,
        message: hasPostAccess && hasAdAccess ? 
          'Page access validated successfully' : 
          'Insufficient permissions - please ensure agency has admin access to this page'
      });

    } catch (pageErr) {
      console.error('Page access validation failed:', pageErr.response?.data || pageErr.message);
      res.status(400).json({ 
        error: 'Cannot access this page. Please ensure you have given our agency admin access to your Facebook page.',
        details: pageErr.response?.data?.error?.message || pageErr.message
      });
    }

  } catch (err) {
    console.error('validatePageAccess error:', err.message);
    res.status(500).json({ error: 'Failed to validate page access' });
  }
};

module.exports = exports;
