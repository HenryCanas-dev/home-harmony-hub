DROP TRIGGER IF EXISTS enforce_task_completion_points_trg ON public.task_completions;
CREATE TRIGGER enforce_task_completion_points_trg
BEFORE INSERT OR UPDATE ON public.task_completions
FOR EACH ROW EXECUTE FUNCTION public.enforce_task_completion_points();
REVOKE UPDATE (points_awarded, status) ON public.task_completions FROM authenticated, anon;