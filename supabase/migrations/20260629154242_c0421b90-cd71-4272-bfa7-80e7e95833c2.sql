
-- Profiles
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles viewable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Frequency enum
CREATE TYPE public.task_frequency AS ENUM ('weekly', 'biweekly', 'monthly');

-- Tasks
CREATE TABLE public.tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  frequency public.task_frequency NOT NULL DEFAULT 'weekly',
  points INTEGER NOT NULL DEFAULT 5,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tasks visible to authenticated" ON public.tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Tasks manageable by authenticated" ON public.tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Task completions
CREATE TABLE public.task_completions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  completed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_completions TO authenticated;
GRANT ALL ON public.task_completions TO service_role;
ALTER TABLE public.task_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Completions visible to authenticated" ON public.task_completions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own completions" ON public.task_completions FOR INSERT TO authenticated WITH CHECK (auth.uid() = completed_by);
CREATE POLICY "Users delete own completions" ON public.task_completions FOR DELETE TO authenticated USING (auth.uid() = completed_by);

CREATE INDEX idx_completions_task ON public.task_completions(task_id);
CREATE INDEX idx_completions_completed_at ON public.task_completions(completed_at);
CREATE INDEX idx_completions_user ON public.task_completions(completed_by);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Seed tasks
INSERT INTO public.tasks (title, frequency, points) VALUES
  ('Limpieza / Sacar la basura', 'weekly', 5),
  ('Limpiar cocina y alrededores', 'weekly', 8),
  ('Muebles y ventanas', 'weekly', 6),
  ('Viernes: revisar refri y sobras', 'weekly', 4),
  ('Basureros, escobas y pala', 'biweekly', 7),
  ('Lavar pila', 'monthly', 10),
  ('Limpiar refri', 'monthly', 12);
