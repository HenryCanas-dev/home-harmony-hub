
-- Restrict UPDATE/DELETE on tasks and task_instances to owners, assign_to_all, or unassigned
DROP POLICY IF EXISTS "Authenticated can update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Authenticated can delete tasks" ON public.tasks;
DROP POLICY IF EXISTS "Authenticated can update instances" ON public.task_instances;
DROP POLICY IF EXISTS "Authenticated can delete instances" ON public.task_instances;

CREATE POLICY "Owners can update tasks"
  ON public.tasks
  FOR UPDATE
  TO authenticated
  USING (assigned_to = auth.uid() OR assign_to_all OR assigned_to IS NULL)
  WITH CHECK (assigned_to = auth.uid() OR assign_to_all OR assigned_to IS NULL);

CREATE POLICY "Owners can delete tasks"
  ON public.tasks
  FOR DELETE
  TO authenticated
  USING (assigned_to = auth.uid() OR assign_to_all OR assigned_to IS NULL);

CREATE POLICY "Owners can update instances"
  ON public.task_instances
  FOR UPDATE
  TO authenticated
  USING (assigned_to = auth.uid() OR assign_to_all OR assigned_to IS NULL)
  WITH CHECK (assigned_to = auth.uid() OR assign_to_all OR assigned_to IS NULL);

CREATE POLICY "Owners can delete instances"
  ON public.task_instances
  FOR DELETE
  TO authenticated
  USING (assigned_to = auth.uid() OR assign_to_all OR assigned_to IS NULL);
