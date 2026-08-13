import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  CheckCircle2, Circle, LogOut, Plus, Trash2, Trophy, Sparkles, Home, Pencil, Bell, BellOff,
  ChevronLeft, ChevronRight, CalendarClock, Users,
} from "lucide-react";
import { useTaskReminders } from "@/hooks/use-task-reminders";
import { computeStatus, pointsFor, STATUS_LABEL, STATUS_COLOR, type CompletionStatus } from "@/lib/points";
import { startOfWeek, addDays, toISODate, formatWeekLabel, formatDate, formatDateTime, isSameDay } from "@/lib/periods";
import { updateTaskAssignment } from "@/lib/task-actions.functions";
import { InstallAppButton } from "@/components/install-app-button";

type Frequency = "weekly" | "biweekly" | "monthly";

interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  frequency: Frequency;
  points: number;
  assigned_to: string | null;
  active: boolean;
  assign_to_all: boolean;
  last_assigned_to: string | null;
}

interface TaskInstance {
  id: string;
  task_id: string;
  period_key: string;
  period_start: string; // date
  period_end: string;   // date
  due_date: string;     // date
  assigned_to: string | null;
  assign_to_all: boolean;
}

interface Completion {
  id: string;
  task_id: string;
  completed_by: string;
  points_awarded: number;
  completed_at: string;
  instance_id: string | null;
  status: CompletionStatus | null;
}

const FREQ_LABEL: Record<Frequency, string> = {
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
};

const FREQ_COLOR: Record<Frequency, string> = {
  weekly: "bg-primary/10 text-primary border-primary/20",
  biweekly: "bg-accent/20 text-accent-foreground border-accent/30",
  monthly: "bg-warning/20 text-warning-foreground border-warning/30",
};

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Casa Compartida · Tareas del hogar" },
      { name: "description", content: "Reparte, completa y gana puntos por las tareas del hogar." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const router = useRouter();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Semana visualizada (siempre lunes)
  const todayMonday = useMemo(() => startOfWeek(new Date()), []);
  const [viewMonday, setViewMonday] = useState<Date>(todayMonday);
  const isCurrentWeek = isSameDay(viewMonday, todayMonday);
  const isFutureWeek = viewMonday.getTime() > todayMonday.getTime();
  const viewMondayISO = toISODate(viewMonday);

  // Asegura instancias para la semana actual al entrar
  useEffect(() => {
    supabase.rpc("ensure_period_instances", { week_start: toISODate(todayMonday) }).then(({ error }) => {
      if (error) console.error("ensure_period_instances", error);
      qc.invalidateQueries({ queryKey: ["task_instances"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    });
  }, [todayMonday, qc]);

  const profilesQ = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").order("created_at");
      if (error) throw error;
      return data as Profile[];
    },
  });

  const tasksQ = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks").select("*").eq("active", true).order("created_at");
      if (error) throw error;
      return data as Task[];
    },
  });

  // Instancias que cubren la semana vista (período_start <= viewMonday <= período_end)
  const instancesQ = useQuery({
    queryKey: ["task_instances", viewMondayISO],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_instances")
        .select("*")
        .lte("period_start", viewMondayISO)
        .gte("period_end", viewMondayISO);
      if (error) throw error;
      return data as TaskInstance[];
    },
  });

  const completionsQ = useQuery({
    queryKey: ["completions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_completions")
        .select("*")
        .order("completed_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data as Completion[];
    },
  });

  const profiles = profilesQ.data ?? [];
  const tasks = tasksQ.data ?? [];
  const instances = instancesQ.data ?? [];
  const completions = completionsQ.data ?? [];

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const profilesById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const completionsByInstance = useMemo(() => {
    const m = new Map<string, Completion[]>();
    for (const c of completions) {
      if (!c.instance_id) continue;
      const arr = m.get(c.instance_id) ?? [];
      arr.push(c);
      m.set(c.instance_id, arr);
    }
    return m;
  }, [completions]);

  // Mutations
  const completeMut = useMutation({
    mutationFn: async ({ instance, task }: { instance: TaskInstance; task: Task }) => {
      if (!userId) throw new Error("No user");
      const status = computeStatus(instance.due_date);
      const points = pointsFor(task.points, status);
      const { error } = await supabase.from("task_completions").insert({
        task_id: task.id,
        completed_by: userId,
        points_awarded: points,
        instance_id: instance.id,
        status,
      });
      if (error) throw error;
      return { status, points };
    },
    onSuccess: ({ status, points }) => {
      qc.invalidateQueries({ queryKey: ["completions"] });
      const msg =
        status === "on_time" ? `¡A tiempo! +${points} pts 🎉` :
        status === "late" ? `Completada tarde (+${points} pts)` :
        `Muy tarde (+${points} pts)`;
      toast.success(msg);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const undoMut = useMutation({
    mutationFn: async (completionId: string) => {
      const { error } = await supabase.from("task_completions").delete().eq("id", completionId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["completions"] });
      toast.success("Marcado como pendiente");
    },
  });

  const assignMut = useMutation({
    mutationFn: async ({
      instance,
      profileId,
      assignToAll,
    }: {
      instance: TaskInstance;
      profileId: string | null;
      assignToAll: boolean;
    }) => {
      await updateTaskAssignment({
        data: {
          taskId: instance.task_id,
          instanceId: instance.id,
          assignToAll,
          profileId,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task_instances"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteTaskMut = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase.from("tasks").update({ active: false }).eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task_instances"] });
      toast.success("Tarea eliminada");
    },
  });

  const signOut = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth" });
  };

  // Ranking (semana calendario / mes actual)
  const startOfCurrentWeek = todayMonday;
  const startOfMonth = useMemo(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1), []);

  const weekScore = (pid: string) =>
    completions
      .filter((c) => c.completed_by === pid && new Date(c.completed_at) >= startOfCurrentWeek)
      .reduce((s, c) => s + c.points_awarded, 0);

  const monthScore = (pid: string) =>
    completions
      .filter((c) => c.completed_by === pid && new Date(c.completed_at) >= startOfMonth)
      .reduce((s, c) => s + c.points_awarded, 0);

  const me = profiles.find((p) => p.id === userId);

  // Pendientes: tareas de la semana actual asignadas a mí (o assign_to_all) sin mi completion
  const myPending = useMemo(() => {
    if (!userId) return [];
    return instances
      .filter((inst) => {
        if (!isCurrentWeek) return false;
        const t = tasksById.get(inst.task_id);
        if (!t) return false;
        const iCompleted = (completionsByInstance.get(inst.id) ?? []).some((c) => c.completed_by === userId);
        if (iCompleted) return false;
        if (inst.assign_to_all) return true;
        return inst.assigned_to === userId;
      })
      .map((inst) => {
        const t = tasksById.get(inst.task_id)!;
        return { id: inst.id, title: t.title, dueDate: inst.due_date, assignedToMe: true, done: false };
      });
  }, [instances, tasksById, completionsByInstance, userId, isCurrentWeek]);

  const { permission, request: requestNotif } = useTaskReminders(myPending);

  // Historial: últimas 12 semanas navegables
  const historyWeeks = useMemo(() => {
    const arr: Date[] = [];
    for (let i = 0; i < 12; i++) arr.push(addDays(todayMonday, -7 * i));
    return arr;
  }, [todayMonday]);

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Home className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-none">Casa Compartida</h1>
              <p className="text-xs text-muted-foreground">Tareas del hogar</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {me && (
              <div className="hidden sm:flex items-center gap-2">
                <Avatar className="w-8 h-8">
                  <AvatarImage src={me.avatar_url ?? undefined} />
                  <AvatarFallback>{me.display_name[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium">{me.display_name}</span>
              </div>
            )}
            <InstallAppButton className="gap-1" />
            {permission !== "unsupported" && permission !== "granted" && (
              <Button variant="outline" size="sm" onClick={requestNotif} className="gap-1" title="Activar notificaciones">
                <BellOff className="w-4 h-4" />
                <span className="hidden sm:inline">Activar avisos</span>
              </Button>
            )}
            {permission === "granted" && (
              <Bell className="w-4 h-4 text-success" aria-label="Notificaciones activas" />
            )}
            <Button variant="ghost" size="icon" onClick={signOut} title="Cerrar sesión">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {userId && isCurrentWeek && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-primary" />
                  <h2 className="font-bold">Tus pendientes</h2>
                </div>
                <Badge variant="secondary" className="font-bold">{myPending.length}</Badge>
              </div>
              {myPending.length === 0 ? (
                <p className="text-sm text-muted-foreground">¡Todo al día! No tienes tareas pendientes 🎉</p>
              ) : (
                <ul className="space-y-1">
                  {myPending.map((p) => (
                    <li key={p.id} className="text-sm flex items-center gap-2">
                      <Circle className="w-3 h-3 text-primary" />
                      {p.title}
                    </li>
                  ))}
                </ul>
              )}
              {permission === "default" && (
                <p className="text-xs text-muted-foreground mt-3">
                  💡 Activa los avisos para recibir notificaciones en tu celular. Instala la app desde el menú del navegador ("Agregar a pantalla de inicio") para recibirlas como una app nativa.
                </p>
              )}
              {permission === "denied" && (
                <p className="text-xs text-destructive mt-3">
                  Las notificaciones están bloqueadas. Actívalas en los ajustes del navegador.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Ranking */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-5 h-5 text-accent" />
            <h2 className="text-xl font-bold">Ranking</h2>
          </div>
          <Tabs defaultValue="week">
            <TabsList>
              <TabsTrigger value="week">Esta semana</TabsTrigger>
              <TabsTrigger value="month">Este mes</TabsTrigger>
            </TabsList>
            <TabsContent value="week">
              <RankingList profiles={profiles} getScore={weekScore} />
            </TabsContent>
            <TabsContent value="month">
              <RankingList profiles={profiles} getScore={monthScore} />
            </TabsContent>
          </Tabs>
        </section>

        {/* Tasks + week navigator */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-bold">Tareas</h2>
            </div>
            {isCurrentWeek && (
              <TaskDialog profiles={profiles} onSaved={async () => {
                await supabase.rpc("ensure_period_instances", { week_start: toISODate(todayMonday) });
                qc.invalidateQueries({ queryKey: ["tasks"] });
                qc.invalidateQueries({ queryKey: ["task_instances"] });
              }} />
            )}
          </div>

          {/* Week navigator */}
          <Card className="mb-3">
            <CardContent className="p-3 flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => setViewMonday(addDays(viewMonday, -7))} className="gap-1">
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Anterior</span>
              </Button>
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-muted-foreground" />
                <Select value={viewMondayISO} onValueChange={(v) => setViewMonday(new Date(v + "T00:00:00"))}>
                  <SelectTrigger className="h-9 min-w-[220px]">
                    <SelectValue>
                      <span className="font-medium">
                        {isCurrentWeek ? "Semana actual · " : ""}
                        {formatWeekLabel(viewMonday)}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {historyWeeks.map((m, i) => (
                      <SelectItem key={toISODate(m)} value={toISODate(m)}>
                        {i === 0 ? "Semana actual · " : i === 1 ? "Semana anterior · " : `Hace ${i} sem · `}
                        {formatWeekLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMonday(addDays(viewMonday, 7))}
                disabled={isCurrentWeek || isFutureWeek}
                className="gap-1"
              >
                <span className="hidden sm:inline">Siguiente</span>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>

          {!isCurrentWeek && (
            <p className="text-xs text-muted-foreground mb-3">
              Estás viendo el historial. Solo puedes marcar tareas como completadas (contarán como tarde según la fecha).
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {instances
              .filter((inst) => {
                // En la semana actual, ocultar instancias ya completadas:
                // - assign_to_all: ocultar cuando YO ya la hice (los demás la ven en su sesión)
                // - normal: ocultar cuando cualquiera la completó
                // En historial mostramos todo para auditoría.
                if (!isCurrentWeek) return true;
                const insC = completionsByInstance.get(inst.id) ?? [];
                if (inst.assign_to_all) return !insC.some((c) => c.completed_by === userId);
                return insC.length === 0;
              })
              .map((inst) => {
              const task = tasksById.get(inst.task_id);
              if (!task) return null;
              const insCompletions = completionsByInstance.get(inst.id) ?? [];
              const myCompletion = insCompletions.find((c) => c.completed_by === userId);
              const done = !!myCompletion;
              const anyDone = insCompletions.length > 0;
              const assignee = inst.assigned_to ? profilesById.get(inst.assigned_to) : undefined;

              return (
                <Card key={inst.id} className={anyDone && !inst.assign_to_all ? "opacity-90" : ""}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge variant="outline" className={FREQ_COLOR[task.frequency]}>
                            {FREQ_LABEL[task.frequency]}
                          </Badge>
                          <Badge variant="secondary" className="font-bold">+{task.points} pts</Badge>
                          {inst.assign_to_all && (
                            <Badge variant="outline" className="gap-1">
                              <Users className="w-3 h-3" /> Todos
                            </Badge>
                          )}
                          {myCompletion?.status && (
                            <Badge variant="outline" className={STATUS_COLOR[myCompletion.status]}>
                              {STATUS_LABEL[myCompletion.status]}
                            </Badge>
                          )}
                        </div>
                        <h3 className={`font-semibold ${done && !inst.assign_to_all ? "line-through" : ""}`}>
                          {task.title}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          Límite: {formatDate(inst.due_date)}
                          {myCompletion && ` · Hecha: ${formatDateTime(myCompletion.completed_at)}`}
                        </p>
                      </div>
                      {isCurrentWeek && (
                        <div className="flex gap-1">
                          <TaskDialog
                            profiles={profiles}
                            task={task}
                            onSaved={async () => {
                              await supabase.rpc("ensure_period_instances", { week_start: toISODate(todayMonday) });
                              qc.invalidateQueries({ queryKey: ["tasks"] });
                              qc.invalidateQueries({ queryKey: ["task_instances"] });
                            }}
                            trigger={
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                            }
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => deleteTaskMut.mutate(task.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      {inst.assign_to_all ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          {profiles.map((p) => {
                            const c = insCompletions.find((x) => x.completed_by === p.id);
                            return (
                              <div
                                key={p.id}
                                className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${c ? "bg-success/10 border-success/30" : "bg-muted/50"}`}
                                title={c ? `${p.display_name} · ${c.status ? STATUS_LABEL[c.status] : ""}` : p.display_name}
                              >
                                {c ? <CheckCircle2 className="w-3 h-3 text-success" /> : <Circle className="w-3 h-3" />}
                                <span>{p.display_name.split(" ")[0]}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        isCurrentWeek ? (
                          <Select
                            value={inst.assigned_to ?? "none"}
                            onValueChange={(v) => {
                              if (v === "all") {
                                assignMut.mutate({ instance: inst, profileId: null, assignToAll: true });
                                return;
                              }
                              assignMut.mutate({
                                instance: inst,
                                profileId: v === "none" ? null : v,
                                assignToAll: false,
                              });
                            }}
                            disabled={assignMut.isPending}
                          >
                            <SelectTrigger className="h-9 flex-1 max-w-[180px]">
                              <SelectValue placeholder="Asignar a..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Todos</SelectItem>
                              <SelectItem value="none">Sin asignar</SelectItem>
                              {profiles.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="text-xs text-muted-foreground flex items-center gap-2">
                            {assignee ? (
                              <>
                                <Avatar className="w-5 h-5">
                                  <AvatarImage src={assignee.avatar_url ?? undefined} />
                                  <AvatarFallback className="text-[10px]">
                                    {assignee.display_name[0]?.toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                Asignada a {assignee.display_name}
                              </>
                            ) : (
                              <span>Sin asignar</span>
                            )}
                          </div>
                        )
                      )}

                      {done ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => myCompletion && undoMut.mutate(myCompletion.id)}
                          className="gap-1"
                          disabled={myCompletion?.completed_by !== userId}
                        >
                          <CheckCircle2 className="w-4 h-4 text-success" />
                          Hecha
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => completeMut.mutate({ instance: inst, task })} className="gap-1">
                          <Circle className="w-4 h-4" />
                          Completar
                        </Button>
                      )}
                    </div>

                    {!inst.assign_to_all && isCurrentWeek && assignee && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Avatar className="w-5 h-5">
                          <AvatarImage src={assignee.avatar_url ?? undefined} />
                          <AvatarFallback className="text-[10px]">
                            {assignee.display_name[0]?.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        Asignada a {assignee.display_name}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {instances.length === 0 && (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              {isCurrentWeek
                ? "No hay tareas todavía. Crea la primera."
                : "No hay tareas registradas para esta semana."}
            </CardContent></Card>
          )}
        </section>
      </main>
    </div>
  );
}

function RankingList({
  profiles,
  getScore,
}: {
  profiles: Profile[];
  getScore: (pid: string) => number;
}) {
  const sorted = [...profiles].map((p) => ({ p, score: getScore(p.id) })).sort((a, b) => b.score - a.score);
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        {sorted.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Esperando a que tus roommates inicien sesión...
          </p>
        )}
        {sorted.map(({ p, score }, idx) => (
          <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40">
            <span className="text-2xl w-8 text-center">{medals[idx] ?? `#${idx + 1}`}</span>
            <Avatar className="w-10 h-10">
              <AvatarImage src={p.avatar_url ?? undefined} />
              <AvatarFallback>{p.display_name[0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">{p.display_name}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-primary leading-none">{score}</p>
              <p className="text-xs text-muted-foreground">pts</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TaskDialog({
  profiles,
  task,
  onSaved,
  trigger,
}: {
  profiles: Profile[];
  task?: Task;
  onSaved: () => void;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(task?.title ?? "");
  const [frequency, setFrequency] = useState<Frequency>(task?.frequency ?? "weekly");
  const [points, setPoints] = useState(task?.points ?? 5);
  const [assignedTo, setAssignedTo] = useState<string>(task?.assigned_to ?? "none");
  const [assignToAll, setAssignToAll] = useState<boolean>(task?.assign_to_all ?? false);

  useEffect(() => {
    if (open && task) {
      setTitle(task.title);
      setFrequency(task.frequency);
      setPoints(task.points);
      setAssignedTo(task.assigned_to ?? "none");
      setAssignToAll(task.assign_to_all);
    } else if (open && !task) {
      setTitle(""); setFrequency("weekly"); setPoints(5); setAssignedTo("none"); setAssignToAll(false);
    }
  }, [open, task]);

  const save = async () => {
    if (!title.trim()) {
      toast.error("Ponle un título a la tarea");
      return;
    }
    const nextAssigned = assignToAll ? null : (assignedTo === "none" ? null : assignedTo);
    const payload = {
      title: title.trim(),
      frequency,
      points,
      assign_to_all: assignToAll,
      assigned_to: nextAssigned,
    };
    if (task) {
      const { data, error } = await supabase
        .from("tasks")
        .update(payload)
        .eq("id", task.id)
        .select();
      if (error) {
        toast.error(error.message);
        return;
      }
      if (!data || data.length === 0) {
        toast.error("No se pudo guardar (permiso denegado)");
        return;
      }
      // Sincronizar instancias vigentes/futuras para que reflejen assign_to_all y asignado
      const todayISO = new Date().toISOString().slice(0, 10);
      const { error: eInst } = await supabase
        .from("task_instances")
        .update({ assign_to_all: assignToAll, assigned_to: assignToAll ? null : nextAssigned })
        .eq("task_id", task.id)
        .gte("period_end", todayISO);
      if (eInst) {
        toast.error(eInst.message);
        return;
      }
    } else {
      const { error } = await supabase.from("tasks").insert(payload);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    toast.success(task ? "Tarea actualizada" : "Tarea creada");
    setOpen(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="gap-1">
            <Plus className="w-4 h-4" /> Nueva tarea
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task ? "Editar tarea" : "Nueva tarea"}</DialogTitle>
          <DialogDescription>
            Define qué hay que hacer, cada cuánto y cuántos puntos vale.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="title">Título</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lavar baño" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Frecuencia</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as Frequency)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Semanal</SelectItem>
                  <SelectItem value="biweekly">Quincenal</SelectItem>
                  <SelectItem value="monthly">Mensual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="points">Puntos</Label>
              <Input
                id="points"
                type="number"
                min={1}
                value={points}
                onChange={(e) => setPoints(parseInt(e.target.value) || 1)}
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="all">Asignar a todos</Label>
              <p className="text-xs text-muted-foreground">
                Todos los roommates la ven, la completan y ganan puntos individualmente.
              </p>
            </div>
            <Switch id="all" checked={assignToAll} onCheckedChange={setAssignToAll} />
          </div>
          {!assignToAll && (
            <div className="space-y-2">
              <Label>Responsable actual (la rotación seguirá desde aquí)</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={save}>{task ? "Guardar" : "Crear"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
