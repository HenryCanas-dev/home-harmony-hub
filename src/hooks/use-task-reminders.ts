import { useEffect, useRef, useState } from "react";

export type ReminderTask = {
  id: string;
  title: string;
  dueDate: string;
  assignedToMe: boolean;
  done: boolean;
};

const NOTIFIED_KEY = "casa_notified_tasks_v1";

function loadNotified(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveNotified(data: Record<string, number>) {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(data));
}

export type NotifPermission = "default" | "granted" | "denied" | "unsupported";

export function useTaskReminders(tasks: ReminderTask[]) {
  const [permission, setPermission] = useState<NotifPermission>("default");
  const lastFiredRef = useRef<Record<string, number>>({});

  useEffect(() => {
    lastFiredRef.current = loadNotified();
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as NotifPermission);
  }, []);

  const request = async () => {
    if (!("Notification" in window)) return;
    const res = await Notification.requestPermission();
    setPermission(res as NotifPermission);
  };

  // Notify in the final 24 hours, and again after the deadline. One alert per stage/day.
  useEffect(() => {
    if (permission !== "granted") return;
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const updated = { ...lastFiredRef.current };
    let changed = false;

    tasks
      .filter((t) => t.assignedToMe && !t.done)
      .forEach((t) => {
        const due = new Date(`${t.dueDate}T23:59:59`).getTime();
        const remaining = due - now;
        if (remaining > DAY) return;
        const stage = remaining >= 0 ? "soon" : "overdue";
        const notificationKey = `${t.id}:${stage}`;
        const last = updated[notificationKey] ?? 0;
        if (now - last > DAY) {
          try {
            new Notification(stage === "soon" ? "Tarea por vencer 🏠" : "Tarea vencida 🏠", {
              body: stage === "soon" ? `${t.title} vence hoy.` : `${t.title} sigue pendiente.`,
              icon: "/icon-512.png",
              badge: "/icon-512.png",
              tag: `task-${notificationKey}`,
            });
            updated[notificationKey] = now;
            changed = true;
          } catch {
            // ignore
          }
        }
      });

    if (changed) {
      lastFiredRef.current = updated;
      saveNotified(updated);
    }
  }, [tasks, permission]);

  return { permission, request };
}
