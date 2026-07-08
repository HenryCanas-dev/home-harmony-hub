import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const updateTaskAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({
      taskId: z.string().uuid(),
      instanceId: z.string().uuid(),
      assignToAll: z.boolean(),
      profileId: z.string().uuid().nullable(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile, error: profileError } = await context.supabase
      .from("profiles")
      .select("id")
      .eq("id", context.userId)
      .maybeSingle();

    if (profileError) throw new Error(profileError.message);
    if (!profile) throw new Error("No se pudo confirmar tu perfil");

    if (data.profileId) {
      const { data: assignee, error: assigneeError } = await context.supabase
        .from("profiles")
        .select("id")
        .eq("id", data.profileId)
        .maybeSingle();

      if (assigneeError) throw new Error(assigneeError.message);
      if (!assignee) throw new Error("Ese roommate no existe");
    }

    const { data: task, error: taskError } = await context.supabase
      .from("tasks")
      .select("id, active")
      .eq("id", data.taskId)
      .maybeSingle();

    if (taskError) throw new Error(taskError.message);
    if (!task?.active) throw new Error("La tarea ya no está disponible");

    const nextAssignedTo = data.assignToAll ? null : data.profileId;
    const todayISO = new Date().toISOString().slice(0, 10);

    const { error: taskUpdateError } = await supabaseAdmin
      .from("tasks")
      .update({
        assign_to_all: data.assignToAll,
        assigned_to: nextAssignedTo,
        last_assigned_to: nextAssignedTo,
      })
      .eq("id", data.taskId)
      .eq("active", true);

    if (taskUpdateError) throw new Error(taskUpdateError.message);

    const { error: instanceUpdateError } = await supabaseAdmin
      .from("task_instances")
      .update({
        assign_to_all: data.assignToAll,
        assigned_to: nextAssignedTo,
      })
      .eq("task_id", data.taskId)
      .gte("period_end", todayISO);

    if (instanceUpdateError) throw new Error(instanceUpdateError.message);

    return { ok: true };
  });