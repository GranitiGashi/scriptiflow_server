const supabase = require('../config/supabaseClient');

/**
 * Attempts to authenticate the request using the Authorization bearer access token.
 * If the access token is invalid/expired and a refresh token is provided in
 * 'x-refresh-token', it will refresh the session and return the refreshed user.
 * Optionally sets the supabase session for downstream RLS queries.
 */
async function getUserFromRequest(req, { setSession = true, allowRefresh = true } = {}) {
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  const refreshToken = req.headers['x-refresh-token'] || null;

  if (!accessToken) {
    return { error: { status: 401, message: 'Unauthorized: Missing token' } };
  }

  // Try direct getUser first
  let { data: userData, error } = await supabase.auth.getUser(accessToken);
  if (error || !userData?.user) {
    if (!allowRefresh || !refreshToken) {
      return { error: { status: 401, message: 'Unauthorized: Invalid token' } };
    }

    // Attempt refresh with provided refresh token
    const { data: sessionData, error: refreshError } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (refreshError || !sessionData?.session?.access_token) {
      return { error: { status: 401, message: 'Unauthorized: Invalid refresh token' } };
    }

    // Replace with refreshed tokens
    userData = { user: sessionData.user };

    if (setSession) {
      try {
        await supabase.auth.setSession({
          access_token: sessionData.session.access_token,
          refresh_token: sessionData.session.refresh_token,
        });
      } catch (_) {}
    }

    return {
      user: sessionData.user,
      accessToken: sessionData.session.access_token,
      refreshed: true,
      refreshToken: sessionData.session.refresh_token,
    };
  }

  // Access token was valid
  if (setSession) {
    try {
      await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    } catch (_) {}
  }

  return { user: userData.user, accessToken };
}

module.exports = { getUserFromRequest };


