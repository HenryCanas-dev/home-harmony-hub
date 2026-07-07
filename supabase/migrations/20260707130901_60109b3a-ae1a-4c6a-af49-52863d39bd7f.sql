
-- Tighten tasks write policies
DROP POLICY IF EXISTS "Authenticated can insert tasks" ON public.tasks;
DROP POLICY IF EXISTS "Authenticated can update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Authenticated can delete tasks" ON public.tasks;

CREATE POLICY "Authenticated can insert tasks"
  ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Assignee can update tasks"
  ON public.tasks FOR UPDATE TO authenticated
  USING (assigned_to IS NULL OR assign_to_all OR assigned_to = auth.uid())
  WITH CHECK (assigned_to IS NULL OR assign_to_all OR assigned_to = auth.uid());

CREATE POLICY "Assignee can delete tasks"
  ON public.tasks FOR DELETE TO authenticated
  USING (assigned_to IS NULL OR assign_to_all OR assigned_to = auth.uid());

-- Tighten task_instances write policies
DROP POLICY IF EXISTS "Authenticated insert instances" ON public.task_instances;
DROP POLICY IF EXISTS "Authenticated update instances" ON public.task_instances;
DROP POLICY IF EXISTS "Authenticated delete instances" ON public.task_instances;

CREATE POLICY "Authenticated insert instances"
  ON public.task_instances FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Assignee can update instances"
  ON public.task_instances FOR UPDATE TO authenticated
  USING (assigned_to IS NULL OR assign_to_all OR assigned_to = auth.uid())
  WITH CHECK (assigned_to IS NULL OR assign_to_all OR assigned_to = auth.uid());

CREATE POLICY "Assignee can delete instances"
  ON public.task_instances FOR DELETE TO authenticated
  USING (assigned_to IS NULL OR assign_to_all OR assigned_to = auth.uid());

-- Restrict SECURITY DEFINER function to authenticated only
REVOKE ALL ON FUNCTION public.ensure_period_instances(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_period_instances(date) TO authenticated;

-- Add caller-auth guard inside the definer function
CREATE OR REPLACE FUNCTION public.ensure_period_instances(week_start date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

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
$function$;
