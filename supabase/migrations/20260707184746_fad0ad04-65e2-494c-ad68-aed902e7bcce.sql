
CREATE OR REPLACE FUNCTION public.enforce_task_completion_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_points int;
  due date;
  computed_status text;
  multiplier numeric;
  diff_days numeric;
BEGIN
  SELECT points INTO base_points FROM public.tasks WHERE id = NEW.task_id;
  IF base_points IS NULL THEN
    RAISE EXCEPTION 'Task % not found', NEW.task_id;
  END IF;

  IF NEW.instance_id IS NOT NULL THEN
    SELECT due_date INTO due FROM public.task_instances WHERE id = NEW.instance_id;
  END IF;

  IF due IS NULL THEN
    computed_status := 'on_time';
  ELSE
    diff_days := EXTRACT(EPOCH FROM (COALESCE(NEW.completed_at, now()) - (due + time '23:59:59'))) / 86400.0;
    IF diff_days <= 0 THEN
      computed_status := 'on_time';
    ELSIF diff_days <= 7 THEN
      computed_status := 'late';
    ELSE
      computed_status := 'very_late';
    END IF;
  END IF;

  multiplier := CASE computed_status
    WHEN 'on_time' THEN 1.0
    WHEN 'late' THEN 0.5
    WHEN 'very_late' THEN 0.25
    ELSE 0
  END;

  NEW.status := computed_status;
  NEW.points_awarded := round(base_points * multiplier);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_task_completion_points_trg ON public.task_completions;
CREATE TRIGGER enforce_task_completion_points_trg
BEFORE INSERT ON public.task_completions
FOR EACH ROW EXECUTE FUNCTION public.enforce_task_completion_points();

ALTER TABLE public.task_completions
  DROP CONSTRAINT IF EXISTS task_completions_points_sane;
ALTER TABLE public.task_completions
  ADD CONSTRAINT task_completions_points_sane
  CHECK (points_awarded >= 0 AND points_awarded <= 1000);
