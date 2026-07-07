
DROP POLICY IF EXISTS "Owners can update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Owners can delete tasks" ON public.tasks;
DROP POLICY IF EXISTS "Owners can update instances" ON public.task_instances;
DROP POLICY IF EXISTS "Owners can delete instances" ON public.task_instances;

CREATE POLICY "Authenticated update tasks" ON public.tasks
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated delete tasks" ON public.tasks
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated update instances" ON public.task_instances
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated delete instances" ON public.task_instances
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
