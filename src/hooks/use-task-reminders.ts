import { useEffect, useRef, useState } from "react";

export type ReminderTask = {
  id: string;
  title: string;
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
  const lastFiredRef = useRef<Record<string, number>>(loadNotified());

  useEffect(() => {
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

  // Fire notifications for pending tasks assigned to me, max once per 6h per task
  useEffect(() => {
    if (permission !== "granted") return;
    const now = Date.now();
    const SIX_H = 6 * 60 * 60 * 1000;
    const updated = { ...lastFiredRef.current };
    let changed = false;

    tasks
      .filter((t) => t.assignedToMe && !t.done)
      .forEach((t) => {
        const last = updated[t.id] ?? 0;
        if (now - last > SIX_H) {
          try {
            new Notification("Tarea pendiente 🏠", {
              body: t.title,
              icon: "/icon-512.png",
              badge: "/icon-512.png",
              tag: `task-${t.id}`,
            });
            updated[t.id] = now;
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
