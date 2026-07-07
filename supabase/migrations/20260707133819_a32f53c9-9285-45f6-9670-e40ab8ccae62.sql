
-- Relajar RLS: en una app de roommates compartida, cualquier autenticado puede editar tareas e instancias
DROP POLICY IF EXISTS "Assignee can update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Assignee can delete tasks" ON public.tasks;
DROP POLICY IF EXISTS "Assignee can update instances" ON public.task_instances;
DROP POLICY IF EXISTS "Assignee can delete instances" ON public.task_instances;

CREATE POLICY "Authenticated can update tasks" ON public.tasks
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can delete tasks" ON public.tasks
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can update instances" ON public.task_instances
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can delete instances" ON public.task_instances
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
