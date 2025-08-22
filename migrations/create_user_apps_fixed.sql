-- Fixed User Apps Migration for Supabase
-- This works with your existing schema structure

-- First, add admin role to existing users_app table if not exists
-- Your users_app table already has role field, so we'll just make sure it can accept 'admin'

-- Create the user_apps table (note: different from users_app)
CREATE TABLE IF NOT EXISTS public.user_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users_app(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  icon_url TEXT,
  external_url TEXT NOT NULL,
  background_color VARCHAR(7) DEFAULT '#f3f4f6',
  text_color VARCHAR(7) DEFAULT '#374151',
  position INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_admin_created BOOLEAN DEFAULT false,
  created_by_admin UUID REFERENCES public.users_app(id),
  is_locked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_apps_user_id ON public.user_apps(user_id);
CREATE INDEX IF NOT EXISTS idx_user_apps_position ON public.user_apps(user_id, position);
CREATE INDEX IF NOT EXISTS idx_user_apps_admin ON public.user_apps(created_by_admin, is_admin_created);
CREATE INDEX IF NOT EXISTS idx_users_app_role ON public.users_app(role);

-- Enable Row Level Security
ALTER TABLE public.user_apps ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can manage their own non-admin apps" ON public.user_apps;
DROP POLICY IF EXISTS "Users can view all their apps" ON public.user_apps;
DROP POLICY IF EXISTS "Admins can manage all apps" ON public.user_apps;

-- Create RLS policies
CREATE POLICY "Users can manage their own non-admin apps" ON public.user_apps
  FOR ALL USING (
    user_id = auth.uid() AND (is_admin_created = false OR is_admin_created IS NULL)
  );

CREATE POLICY "Users can view all their apps" ON public.user_apps
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can manage all apps" ON public.user_apps
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users_app 
      WHERE id = auth.uid() 
      AND (role = 'admin' OR email LIKE '%@admin.%')
    )
  );

-- Function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users_app 
    WHERE id = user_id 
    AND (role = 'admin' OR email LIKE '%@admin.%')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Insert default apps template (using a dummy UUID for defaults)
-- These will be copied for each new user
INSERT INTO public.user_apps (
  user_id, 
  name, 
  icon_url, 
  external_url, 
  background_color, 
  text_color, 
  position,
  is_admin_created,
  is_locked
) VALUES 
  ('00000000-0000-0000-0000-000000000000', 'mobile.de', 'https://www.mobile.de/favicon.ico', 'https://www.mobile.de', '#00a651', '#ffffff', 1, false, false),
  ('00000000-0000-0000-0000-000000000000', 'AutoScout24', 'https://www.autoscout24.de/favicon.ico', 'https://www.autoscout24.de', '#f47920', '#ffffff', 2, false, false),
  ('00000000-0000-0000-0000-000000000000', 'Facebook', 'https://www.facebook.com/favicon.ico', 'https://www.facebook.com', '#1877f2', '#ffffff', 3, false, false),
  ('00000000-0000-0000-0000-000000000000', 'Instagram', 'https://www.instagram.com/favicon.ico', 'https://www.instagram.com', '#e4405f', '#ffffff', 4, false, false),
  ('00000000-0000-0000-0000-000000000000', 'Gmail', 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico', 'https://gmail.com', '#ea4335', '#ffffff', 5, false, false),
  ('00000000-0000-0000-0000-000000000000', 'Outlook', 'https://outlook.live.com/favicon.ico', 'https://outlook.live.com', '#0078d4', '#ffffff', 6, false, false)
ON CONFLICT DO NOTHING;

-- Create a function to copy default apps for new users
CREATE OR REPLACE FUNCTION public.copy_default_apps_for_user(target_user_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Check if user already has apps
  IF EXISTS (SELECT 1 FROM public.user_apps WHERE user_id = target_user_id AND is_active = true) THEN
    RETURN; -- User already has apps, don't copy defaults
  END IF;

  -- Copy default apps
  INSERT INTO public.user_apps (
    user_id, name, icon_url, external_url, background_color, text_color, position, is_admin_created, is_locked, created_at, updated_at
  )
  SELECT 
    target_user_id, name, icon_url, external_url, background_color, text_color, position, is_admin_created, is_locked, NOW(), NOW()
  FROM public.user_apps 
  WHERE user_id = '00000000-0000-0000-0000-000000000000' 
  AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to auto-copy default apps for new users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Copy default apps for the new user
  PERFORM public.copy_default_apps_for_user(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON public.users_app;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON public.users_app
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

