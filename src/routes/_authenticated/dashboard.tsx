import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  CheckCircle2, Circle, LogOut, Plus, Trash2, Trophy, Sparkles, Home, Pencil, Bell, BellOff,
} from "lucide-react";
import { useTaskReminders } from "@/hooks/use-task-reminders";

type Frequency = "weekly" | "biweekly" | "monthly";

interface Profile {
  id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  frequency: Frequency;
  points: number;
  assigned_to: string | null;
  active: boolean;
}

interface Completion {
  id: string;
  task_id: string;
  completed_by: string;
  points_awarded: number;
  completed_at: string;
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

  const profilesQ = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").order("display_name");
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

  const completionsQ = useQuery({
    queryKey: ["completions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_completions")
        .select("*")
        .order("completed_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as Completion[];
    },
  });

  const completeMut = useMutation({
    mutationFn: async (task: Task) => {
      if (!userId) throw new Error("No user");
      const { error } = await supabase.from("task_completions").insert({
        task_id: task.id,
        completed_by: userId,
        points_awarded: task.points,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["completions"] });
      toast.success("¡Tarea completada! 🎉");
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
    mutationFn: async ({ taskId, profileId }: { taskId: string; profileId: string | null }) => {
      const { error } = await supabase.from("tasks").update({ assigned_to: profileId }).eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const deleteTaskMut = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase.from("tasks").update({ active: false }).eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Tarea eliminada");
    },
  });

  const signOut = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth" });
  };

  const profiles = profilesQ.data ?? [];
  const tasks = tasksQ.data ?? [];
  const completions = completionsQ.data ?? [];

  // Period helpers
  const now = new Date();
  const startOfWeek = useMemo(() => {
    const d = new Date(now);
    const day = (d.getDay() + 6) % 7; // Monday=0
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [now.toDateString()]);

  const startOfBiweek = useMemo(() => {
    const d = new Date(startOfWeek);
    // align to even ISO week pairs
    const weekNumber = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / (7 * 24 * 3600 * 1000));
    if (weekNumber % 2 === 1) d.setDate(d.getDate() - 7);
    return d;
  }, [startOfWeek]);

  const startOfMonth = useMemo(() => new Date(now.getFullYear(), now.getMonth(), 1), [now.toDateString()]);

  // Is task complete in current period?
  const taskPeriodStart = (t: Task) => {
    if (t.frequency === "weekly") return startOfWeek;
    if (t.frequency === "biweekly") return startOfBiweek;
    return startOfMonth;
  };

  const isCompleteThisPeriod = (t: Task): Completion | null => {
    const start = taskPeriodStart(t).getTime();
    return completions.find((c) => c.task_id === t.id && new Date(c.completed_at).getTime() >= start) ?? null;
  };

  // Ranking
  const weekScore = (pid: string) =>
    completions
      .filter((c) => c.completed_by === pid && new Date(c.completed_at) >= startOfWeek)
      .reduce((s, c) => s + c.points_awarded, 0);

  const monthScore = (pid: string) =>
    completions
      .filter((c) => c.completed_by === pid && new Date(c.completed_at) >= startOfMonth)
      .reduce((s, c) => s + c.points_awarded, 0);

  const me = profiles.find((p) => p.id === userId);

  // Pending tasks assigned to current user
  const myPending = useMemo(
    () => tasks
      .filter((t) => t.assigned_to === userId && !isCompleteThisPeriod(t))
      .map((t) => ({ id: t.id, title: t.title, assignedToMe: true, done: false })),
    [tasks, completions, userId],
  );
  const { permission, request: requestNotif } = useTaskReminders(myPending);


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
            {permission !== "unsupported" && permission !== "granted" && (
              <Button
                variant="outline"
                size="sm"
                onClick={requestNotif}
                className="gap-1"
                title="Activar notificaciones"
              >
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
        {userId && (
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

        {/* Tasks */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-bold">Tareas</h2>
            </div>
            <TaskDialog profiles={profiles} onSaved={() => qc.invalidateQueries({ queryKey: ["tasks"] })} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {tasks.map((t) => {
              const done = isCompleteThisPeriod(t);
              const assignee = profiles.find((p) => p.id === t.assigned_to);
              return (
                <Card key={t.id} className={done ? "opacity-70" : ""}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge variant="outline" className={FREQ_COLOR[t.frequency]}>
                            {FREQ_LABEL[t.frequency]}
                          </Badge>
                          <Badge variant="secondary" className="font-bold">
                            +{t.points} pts
                          </Badge>
                        </div>
                        <h3 className={`font-semibold ${done ? "line-through" : ""}`}>{t.title}</h3>
                      </div>
                      <div className="flex gap-1">
                        <TaskDialog
                          profiles={profiles}
                          task={t}
                          onSaved={() => qc.invalidateQueries({ queryKey: ["tasks"] })}
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
                          onClick={() => deleteTaskMut.mutate(t.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <Select
                        value={t.assigned_to ?? "none"}
                        onValueChange={(v) =>
                          assignMut.mutate({ taskId: t.id, profileId: v === "none" ? null : v })
                        }
                      >
                        <SelectTrigger className="h-9 flex-1 max-w-[180px]">
                          <SelectValue placeholder="Asignar a..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sin asignar</SelectItem>
                          {profiles.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.display_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {done ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => undoMut.mutate(done.id)}
                          className="gap-1"
                        >
                          <CheckCircle2 className="w-4 h-4 text-success" />
                          Hecha
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => completeMut.mutate(t)} className="gap-1">
                          <Circle className="w-4 h-4" />
                          Completar
                        </Button>
                      )}
                    </div>

                    {assignee && (
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

          {tasks.length === 0 && (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              No hay tareas todavía. Crea la primera.
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
          <div
            key={p.id}
            className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40"
          >
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

  useEffect(() => {
    if (open && task) {
      setTitle(task.title);
      setFrequency(task.frequency);
      setPoints(task.points);
      setAssignedTo(task.assigned_to ?? "none");
    } else if (open && !task) {
      setTitle(""); setFrequency("weekly"); setPoints(5); setAssignedTo("none");
    }
  }, [open, task]);

  const save = async () => {
    if (!title.trim()) {
      toast.error("Ponle un título a la tarea");
      return;
    }
    const payload = {
      title: title.trim(),
      frequency,
      points,
      assigned_to: assignedTo === "none" ? null : assignedTo,
    };
    const { error } = task
      ? await supabase.from("tasks").update(payload).eq("id", task.id)
      : await supabase.from("tasks").insert(payload);
    if (error) {
      toast.error(error.message);
      return;
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
          <div className="space-y-2">
            <Label>Asignar a</Label>
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={save}>{task ? "Guardar" : "Crear"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
