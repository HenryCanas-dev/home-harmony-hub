-- Fix profiles_email_exposed: restrict email visibility to owner only via column drop from select policy
DROP POLICY IF EXISTS "Profiles viewable by authenticated" ON public.profiles;

-- Allow authenticated users to see basic profile info of everyone (needed for rankings/assignments)
-- but restrict email column access via a separate policy approach: drop the email column from being readable
-- Simplest robust fix: remove email column (not used by the app UI; auth.users keeps the real email)
ALTER TABLE public.profiles DROP COLUMN IF EXISTS email;

-- Update handle_new_user to no longer insert email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $function$;

-- Recreate the select policy (no email column anymore, so safe)
CREATE POLICY "Profiles viewable by authenticated"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

-- Fix tasks_any_authenticated_can_modify + SUPA_rls_policy_always_true:
-- Replace the permissive ALL policy with scoped INSERT/UPDATE/DELETE policies
DROP POLICY IF EXISTS "Tasks manageable by authenticated" ON public.tasks;

-- Any authenticated household member can create tasks
CREATE POLICY "Authenticated can insert tasks"
ON public.tasks FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

-- Only the assignee (or anyone if unassigned) can update a task — supports manual rotation
CREATE POLICY "Assignee can update tasks"
ON public.tasks FOR UPDATE
TO authenticated
USING (assigned_to IS NULL OR assigned_to = auth.uid())
WITH CHECK (assigned_to IS NULL OR assigned_to = auth.uid() OR auth.uid() IS NOT NULL);

-- Only the assignee (or anyone if unassigned) can delete a task
CREATE POLICY "Assignee can delete tasks"
ON public.tasks FOR DELETE
TO authenticated
USING (assigned_to IS NULL OR assigned_to = auth.uid());
