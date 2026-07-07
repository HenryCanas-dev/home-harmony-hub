
-- 1) Tighten tasks UPDATE/DELETE policies
DROP POLICY IF EXISTS "Authenticated update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Authenticated delete tasks" ON public.tasks;
DROP POLICY IF EXISTS "Owners can update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Owners can delete tasks" ON public.tasks;

CREATE POLICY "Owners can update tasks" ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    assign_to_all
    OR assigned_to IS NULL
    OR assigned_to = auth.uid()
    OR last_assigned_to = auth.uid()
  )
  WITH CHECK (
    assign_to_all
    OR assigned_to IS NULL
    OR assigned_to = auth.uid()
    OR last_assigned_to = auth.uid()
  );

CREATE POLICY "Owners can delete tasks" ON public.tasks
  FOR DELETE TO authenticated
  USING (
    assign_to_all
    OR assigned_to IS NULL
    OR assigned_to = auth.uid()
    OR last_assigned_to = auth.uid()
  );

-- 2) Tighten task_instances UPDATE/DELETE policies
DROP POLICY IF EXISTS "Authenticated update instances" ON public.task_instances;
DROP POLICY IF EXISTS "Authenticated delete instances" ON public.task_instances;
DROP POLICY IF EXISTS "Owners can update instances" ON public.task_instances;
DROP POLICY IF EXISTS "Owners can delete instances" ON public.task_instances;

CREATE POLICY "Owners can update instances" ON public.task_instances
  FOR UPDATE TO authenticated
  USING (
    assign_to_all
    OR assigned_to IS NULL
    OR assigned_to = auth.uid()
  )
  WITH CHECK (
    assign_to_all
    OR assigned_to IS NULL
    OR assigned_to = auth.uid()
  );

CREATE POLICY "Owners can delete instances" ON public.task_instances
  FOR DELETE TO authenticated
  USING (
    assign_to_all
    OR assigned_to IS NULL
    OR assigned_to = auth.uid()
  );

-- 3) Ensure server-side points enforcement trigger is attached
DROP TRIGGER IF EXISTS enforce_task_completion_points_trg ON public.task_completions;
CREATE TRIGGER enforce_task_completion_points_trg
  BEFORE INSERT ON public.task_completions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_task_completion_points();

-- 4) Revoke SECURITY DEFINER function execute from anon/public
REVOKE ALL ON FUNCTION public.ensure_period_instances(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_period_instances(date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.enforce_task_completion_points() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_task_completion_points() TO service_role;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
