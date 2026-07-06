// Multiplicadores de puntos según puntualidad. Modifica libremente.
export const POINT_MULTIPLIERS = {
  on_time: 1.0,
  late: 0.5,
  very_late: 0.25,
} as const;

// Días de gracia después del due_date antes de contar como "tarde".
export const LATE_GRACE_DAYS = 0;
// Después de estos días desde el due_date, se considera "muy tarde".
export const VERY_LATE_AFTER_DAYS = 7;

export type CompletionStatus = keyof typeof POINT_MULTIPLIERS;

export const STATUS_LABEL: Record<CompletionStatus, string> = {
  on_time: "A tiempo",
  late: "Tarde",
  very_late: "Muy tarde",
};

export const STATUS_COLOR: Record<CompletionStatus, string> = {
  on_time: "bg-success/15 text-success-foreground border-success/30",
  late: "bg-warning/20 text-warning-foreground border-warning/30",
  very_late: "bg-destructive/15 text-destructive border-destructive/30",
};

export function computeStatus(dueDateISO: string, completedAt: Date = new Date()): CompletionStatus {
  const due = new Date(dueDateISO + "T23:59:59");
  const diffMs = completedAt.getTime() - due.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays <= LATE_GRACE_DAYS) return "on_time";
  if (diffDays <= VERY_LATE_AFTER_DAYS) return "late";
  return "very_late";
}

export function pointsFor(basePoints: number, status: CompletionStatus): number {
  return Math.round(basePoints * POINT_MULTIPLIERS[status]);
}
