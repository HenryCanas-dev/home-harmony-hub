
-- 1. Extend tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assign_to_all boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Broaden tasks update policy so any roommate can reassign/rotate
DROP POLICY IF EXISTS "Assignee can update tasks" ON public.tasks;
CREATE POLICY "Authenticated can update tasks" ON public.tasks
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Assignee can delete tasks" ON public.tasks;
CREATE POLICY "Authenticated can delete tasks" ON public.tasks
  FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- 2. task_completions: add instance_id + status
ALTER TABLE public.task_completions
  ADD COLUMN IF NOT EXISTS instance_id uuid,
  ADD COLUMN IF NOT EXISTS status text;

ALTER TABLE public.task_completions
  DROP CONSTRAINT IF EXISTS task_completions_status_check;
ALTER TABLE public.task_completions
  ADD CONSTRAINT task_completions_status_check
  CHECK (status IS NULL OR status IN ('on_time','late','very_late'));

-- 3. task_instances
CREATE TABLE IF NOT EXISTS public.task_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  due_date date NOT NULL,
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assign_to_all boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, period_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_instances TO authenticated;
GRANT ALL ON public.task_instances TO service_role;

ALTER TABLE public.task_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Instances visible to authenticated" ON public.task_instances;
CREATE POLICY "Instances visible to authenticated" ON public.task_instances
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert instances" ON public.task_instances;
CREATE POLICY "Authenticated insert instances" ON public.task_instances
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated update instances" ON public.task_instances;
CREATE POLICY "Authenticated update instances" ON public.task_instances
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated delete instances" ON public.task_instances;
CREATE POLICY "Authenticated delete instances" ON public.task_instances
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- FK from task_completions.instance_id
ALTER TABLE public.task_completions
  DROP CONSTRAINT IF EXISTS task_completions_instance_id_fkey;
ALTER TABLE public.task_completions
  ADD CONSTRAINT task_completions_instance_id_fkey
  FOREIGN KEY (instance_id) REFERENCES public.task_instances(id) ON DELETE SET NULL;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS task_instances_period_start_idx ON public.task_instances(period_start);
CREATE INDEX IF NOT EXISTS task_instances_task_id_idx ON public.task_instances(task_id);
CREATE INDEX IF NOT EXISTS task_completions_instance_id_idx ON public.task_completions(instance_id);

-- 4. RPC: ensure_period_instances
CREATE OR REPLACE FUNCTION public.ensure_period_instances(week_start date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
  p_key text;
  p_start date;
  p_end date;
  p_due date;
  prev_id uuid;
  prev_idx int;
  next_id uuid;
  prof_ids uuid[];
  n int;
  iso_week int;
BEGIN
  -- Normalize to Monday
  week_start := (date_trunc('week', week_start::timestamp))::date;
  iso_week := EXTRACT(week FROM week_start)::int;

  SELECT array_agg(id ORDER BY created_at) INTO prof_ids FROM public.profiles;
  n := COALESCE(array_length(prof_ids, 1), 0);

  FOR t IN SELECT * FROM public.tasks WHERE active = true LOOP
    IF t.frequency = 'weekly' THEN
      p_start := week_start;
      p_end := week_start + 6;
      p_key := to_char(week_start, 'IYYY-"W"IW');
    ELSIF t.frequency = 'biweekly' THEN
      IF iso_week % 2 = 0 THEN
        p_start := week_start - 7;
      ELSE
        p_start := week_start;
      END IF;
      p_end := p_start + 13;
      p_key := to_char(p_start, 'IYYY-"B"IW');
    ELSE
      p_start := date_trunc('month', week_start)::date;
      p_end := (date_trunc('month', week_start) + interval '1 month - 1 day')::date;
      p_key := to_char(p_start, 'YYYY-"M"MM');
    END IF;
    p_due := p_end;

    PERFORM 1 FROM public.task_instances WHERE task_id = t.id AND period_key = p_key;
    IF FOUND THEN CONTINUE; END IF;

    IF t.assign_to_all OR n = 0 THEN
      next_id := NULL;
    ELSE
      prev_id := COALESCE(t.last_assigned_to, t.assigned_to);
      IF prev_id IS NULL THEN
        next_id := prof_ids[1];
      ELSE
        prev_idx := array_position(prof_ids, prev_id);
        IF prev_idx IS NULL THEN
          next_id := prof_ids[1];
        ELSE
          next_id := prof_ids[(prev_idx % n) + 1];
        END IF;
      END IF;
    END IF;

    INSERT INTO public.task_instances(task_id, period_key, period_start, period_end, due_date, assigned_to, assign_to_all)
    VALUES (t.id, p_key, p_start, p_end, p_due, next_id, t.assign_to_all);

    IF NOT t.assign_to_all THEN
      UPDATE public.tasks
        SET last_assigned_to = next_id,
            assigned_to = next_id
        WHERE id = t.id;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_period_instances(date) TO authenticated;

-- 5. Seed instances for current week (idempotent thanks to UNIQUE)
SELECT public.ensure_period_instances(CURRENT_DATE);
