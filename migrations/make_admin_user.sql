-- Script to make a user an admin
-- Replace 'your-email@admin.com' with your actual admin email

-- Option 1: Make existing user admin by email
UPDATE public.users_app 
SET role = 'admin' 
WHERE email = 'your-email@admin.com';

-- Option 2: Make existing user admin by ID (if you know the UUID)
-- UPDATE public.users_app 
-- SET role = 'admin' 
-- WHERE id = 'your-user-uuid-here';

-- Option 3: Check which users exist and their current roles
SELECT id, email, full_name, role, created_at 
FROM public.users_app 
ORDER BY created_at DESC;

-- Option 4: Create a new admin user (if needed)
-- Note: This creates a record in users_app but you'll still need to create the auth.users record
-- INSERT INTO public.users_app (id, email, full_name, role, created_at, updated_at)
-- VALUES (
--   gen_random_uuid(),
--   'admin@yourcompany.com',
--   'Admin User',
--   'admin',
--   NOW(),
--   NOW()
-- );

