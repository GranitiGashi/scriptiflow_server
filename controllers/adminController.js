const supabase = require("../config/supabaseClient");
const supabaseAdmin = require("../config/supabaseAdmin");

// Check if user is admin
async function isAdmin(userId) {
  try {
    console.log("🔍 Checking admin status for user ID:", userId);
    
    const { data, error } = await supabaseAdmin
      .from("users_app")
      .select("role, email")
      .eq("id", userId)
      .single();

    console.log("🔍 Admin check result:", { data, error });

    if (error || !data) {
      console.log("❌ Admin check failed:", error?.message || "No data found");
      return false;
    }

    const isAdminRole = data.role === "admin";
    const isAdminEmail = data.email?.includes("@admin.");
    const result = isAdminRole || isAdminEmail;
    
    console.log("🔍 Admin check details:", {
      userId,
      email: data.email,
      role: data.role,
      isAdminRole,
      isAdminEmail,
      finalResult: result
    });

    return result;
  } catch (err) {
    console.error("❌ Admin check error:", err);
    return false;
  }
}

// Get user's apps (admin view)
const getUserApps = async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }

  const token = authHeader.split(" ")[1];
  const refreshToken = req.headers["x-refresh-token"] || "";
  const { userId } = req.params;

  try {
    const {
      data: { user },
      error: tokenError,
    } = await supabase.auth.getUser(token);
    if (tokenError || !user) {
      return res.status(401).json({ error: "Unauthorized: Invalid token" });
    }

    // Check if user is admin
    if (!(await isAdmin(user.id))) {
      return res
        .status(403)
        .json({ error: "Forbidden: Admin access required" });
    }

    // Using admin client - no need for RLS session setup

    // Get user's apps
    const { data: apps, error } = await supabaseAdmin
      .from("user_apps")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("position", { ascending: true });

    if (error) {
      console.error("Error fetching user apps:", error);
      return res.status(500).json({ error: "Failed to fetch user apps" });
    }

    res.json(apps || []);
  } catch (err) {
    console.error("getUserApps error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Create app for specific user (admin only)
const createUserApp = async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }

  const token = authHeader.split(" ")[1];
  const refreshToken = req.headers["x-refresh-token"] || "";
  const { userId } = req.params;
  const {
    name,
    icon_url,
    external_url,
    background_color,
    text_color,
    position,
  } = req.body;

  if (!name || !external_url) {
    return res
      .status(400)
      .json({ error: "Name and external_url are required" });
  }

  try {
    const {
      data: { user },
      error: tokenError,
    } = await supabase.auth.getUser(token);
    if (tokenError || !user) {
      return res.status(401).json({ error: "Unauthorized: Invalid token" });
    }

    // Check if user is admin
    if (!(await isAdmin(user.id))) {
      return res
        .status(403)
        .json({ error: "Forbidden: Admin access required" });
    }

    // Using admin client - no need for RLS session setup

    // Get current max position for this user
    const { data: maxPos } = await supabaseAdmin
      .from("user_apps")
      .select("position")
      .eq("user_id", userId)
      .order("position", { ascending: false })
      .limit(1);

    const nextPosition =
      position || (maxPos && maxPos[0] ? maxPos[0].position + 1 : 1);

    const appData = {
      user_id: userId,
      name,
      icon_url: icon_url || null,
      external_url,
      background_color: background_color || "#f3f4f6",
      text_color: text_color || "#374151",
      position: nextPosition,
      is_admin_created: true,
      created_by_admin: user.id,
      is_locked: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("user_apps")
      .insert(appData)
      .select()
      .single();

    if (error) {
      console.error("Error creating user app:", error);
      return res.status(500).json({ error: "Failed to create app" });
    }

    res.json(data);
  } catch (err) {
    console.error("createUserApp error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Update user app (admin only)
const updateUserApp = async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }

  const token = authHeader.split(" ")[1];
  const refreshToken = req.headers["x-refresh-token"] || "";
  const { userId, appId } = req.params;
  const {
    name,
    icon_url,
    external_url,
    background_color,
    text_color,
    position,
  } = req.body;

  try {
    const {
      data: { user },
      error: tokenError,
    } = await supabase.auth.getUser(token);
    if (tokenError || !user) {
      return res.status(401).json({ error: "Unauthorized: Invalid token" });
    }

    // Check if user is admin
    if (!(await isAdmin(user.id))) {
      return res
        .status(403)
        .json({ error: "Forbidden: Admin access required" });
    }

    // Using admin client - no need for RLS session setup

    const appData = {
      name,
      icon_url: icon_url || null,
      external_url,
      background_color: background_color || "#f3f4f6",
      text_color: text_color || "#374151",
      position: position || 0,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("user_apps")
      .update(appData)
      .eq("id", appId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      console.error("Error updating user app:", error);
      return res.status(500).json({ error: "Failed to update app" });
    }

    res.json(data);
  } catch (err) {
    console.error("updateUserApp error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Delete user app (admin only)
const deleteUserApp = async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }

  const token = authHeader.split(" ")[1];
  const refreshToken = req.headers["x-refresh-token"] || "";
  const { userId, appId } = req.params;

  try {
    const {
      data: { user },
      error: tokenError,
    } = await supabase.auth.getUser(token);
    if (tokenError || !user) {
      return res.status(401).json({ error: "Unauthorized: Invalid token" });
    }

    // Check if user is admin
    if (!(await isAdmin(user.id))) {
      return res
        .status(403)
        .json({ error: "Forbidden: Admin access required" });
    }

    // Using admin client - no need for RLS session setup

    const { error } = await supabaseAdmin
      .from("user_apps")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", appId)
      .eq("user_id", userId);

    if (error) {
      console.error("Error deleting user app:", error);
      return res.status(500).json({ error: "Failed to delete app" });
    }

    res.json({ message: "App deleted successfully" });
  } catch (err) {
    console.error("deleteUserApp error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get all clients for admin (excludes admin users)
const getUsers = async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }
  const token = authHeader.split(" ")[1];
  const refreshToken = req.headers["x-refresh-token"] || "";

  try {
    const {
      data: { user },
      error: tokenError,
    } = await supabase.auth.getUser(token);
    
    console.log("🔍 Token validation result:", {
      user: user ? { id: user.id, email: user.email } : null,
      tokenError: tokenError?.message || null
    });
    
    if (tokenError || !user) {
      console.log("❌ Token validation failed");
      return res.status(401).json({ error: "Unauthorized: Invalid token" });
    }

    // Check if user is admin
    console.log("🔍 Checking if user is admin...");
    const adminCheck = await isAdmin(user.id);
    console.log("🔍 Admin check final result:", adminCheck);
    
    if (!adminCheck) {
      console.log("❌ User is not admin - returning 403");
      return res
        .status(403)
        .json({ error: "Forbidden: Admin access required" });
    }
    
    console.log("✅ User is admin - proceeding with request");

    // Using admin client - no need for RLS session setup
    
    // First, let's see all users to debug
    const { data: allUsers, error: allError } = await supabaseAdmin
      .from("users_app")
      .select("id, email, full_name, role, created_at");

    if (allError) {
      console.error("Error fetching all users:", allError);
      return res.status(500).json({ error: "Failed to fetch users" });
    }

    console.log("All users in database:", allUsers);
    console.log("Total users count:", allUsers?.length || 0);

    // Filter for users with 'client' role specifically
    const clients = allUsers?.filter(user => {
      const isClient = user.role === "client";
      console.log(`User ${user.email}: role=${user.role}, isClient=${isClient}`);
      return isClient;
    }) || [];

    console.log("Filtered clients:", clients);
    console.log("Clients count:", clients.length);

    res.json(clients || []);
  } catch (err) {
    console.error("getUsers error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
};

module.exports = {
  isAdmin,
  getUsers,
  getUserApps,
  createUserApp,
  updateUserApp,
  deleteUserApp,
};
