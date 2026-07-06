Ampliar la app manteniendo diseño, login, ranking y navegación actuales. Todo lo nuevo se agrega; nada se elimina.

## 1. Base de datos (migración nueva, sin borrar datos)

**Modificaciones a `tasks`:**
- `assign_to_all boolean not null default false`
- `last_assigned_to uuid null` (referencia a `profiles.id`) — memoria de rotación por tarea

**Nueva tabla `task_instances`** — una fila por (tarea × período):
- `task_id`, `period_key text` (p.ej. `2026-W27`, `2026-M07`, `2026-B14`)
- `period_start`, `period_end`, `due_date` (todas `date`)
- `assigned_to uuid null`
- Único: `(task_id, period_key)`

**Modificaciones a `task_completions`:**
- `instance_id uuid null` (referencia a `task_instances`)
- `status text` — `on_time` | `late` | `very_late`

**Función RPC `ensure_period_instances(period_start date)`:**
- Recorre tareas activas cuyo período coincide con `period_start` (semanal siempre; quincenal cada 2 semanas desde época; mensual solo primera semana del mes).
- Si no existe instancia para ese `period_key`, la crea.
- Rotación: siguiente perfil (ordenados por `created_at`) después de `tasks.last_assigned_to`; si `assign_to_all=true`, `assigned_to` queda `null`.
- Actualiza `tasks.last_assigned_to` con el asignado nuevo (para tareas normales).

**Migración de datos existentes:**
- Crear instancia para la semana/quincena/mes actual de cada tarea activa, usando `assigned_to` actual como asignado inicial.
- Vincular completions históricos: `instance_id = null` se mantiene (no se pierden), status derivado por fecha vs. inicio de período.

**Grants + RLS:** replicar el patrón actual (autenticados leen/insertan; solo el asignado o creador puede modificar instancia). Función RPC `SECURITY DEFINER`.

## 2. Lógica de puntos

Constantes en un archivo TS `src/lib/points.ts`:
```ts
export const POINT_MULTIPLIERS = { on_time: 1.0, late: 0.5, very_late: 0.25 };
export const LATE_GRACE_DAYS = 0;      // completar después del due_date = late
export const VERY_LATE_AFTER_DAYS = 7; // más de 7 días tras due_date = very_late
```
Al completar (cliente): compara `Date.now()` con `instance.due_date` para calcular `status` y `points_awarded = round(task.points * multiplier)`.

Ranking existente **no cambia**: sigue sumando `points_awarded` de `task_completions`. Solo llegan valores ya reducidos.

## 3. UI (mismo diseño, componentes shadcn actuales)

**Dashboard (`src/routes/_authenticated/dashboard.tsx`):**
- Nuevo selector de semana arriba del bloque de tareas: `‹ Semana anterior | Semana actual | Semana siguiente ›` + botón "Historial" (dropdown con últimas N semanas).
- Estado local `viewPeriodStart`. Query `task_instances` filtrada por `period_start = viewPeriodStart`.
- Solo la semana actual permite editar asignación / crear-borrar tareas. Semanas pasadas: **solo lectura salvo el botón "Completar"** (para tareas atrasadas — guarda `completed_at = now()`, status calculado, aplica multiplicador).
- Cada card muestra: badge de estado (a tiempo / tarde / muy tarde) cuando ya está completada, fecha límite, y fecha real de finalización en el historial.
- Si `assign_to_all=true`: la card muestra checkmark **por roommate** y cada uno completa individualmente (una fila `task_completions` por usuario).
- Al abrir el dashboard: llama a `ensure_period_instances(startOfWeek)` para generar instancias faltantes de la semana actual.

**TaskDialog:**
- Nuevo switch/checkbox "Asignar a todos" que oculta el selector de responsable.
- Selector de responsable actual sigue existiendo (edición manual sobre la instancia actual; también cambia `tasks.assigned_to` para nuevas tareas).

**Pendientes (panel superior):**
- Considera `assign_to_all` (cuenta como pendiente para todos hasta que ese usuario la complete).

## 4. Compatibilidad

- No se toca: auth, `/auth`, `__root`, `_authenticated/route.tsx`, colores, layout, tipografía, componentes de ranking.
- Semanal/quincenal/mensual: se mantienen los tres tipos con la misma UI.
- Notificaciones push actuales siguen funcionando; el hook lee `myPending` recalculado.

## Detalles técnicos

- `period_key`: `weekly → YYYY-Www`, `biweekly → YYYY-Bww` (semana par ISO), `monthly → YYYY-Mmm`.
- `due_date`: `period_end` (domingo para semanal/quincenal, último día del mes para mensual).
- Rotación al crear instancia: si no hay perfiles → `assigned_to=null`. Si `last_assigned_to` es null → primer perfil por `created_at`. Si no encuentra el perfil (borrado) → primer perfil.
- Edición manual actualiza `task_instances.assigned_to` **y** `tasks.last_assigned_to` para que la siguiente rotación continúe desde ahí.
- Todas las instancias son inmutables tras cambiar de semana excepto `assigned_to` en la semana actual y completar tarde en cualquier semana.

## Entregables

Archivos a crear/editar:
- `supabase/migrations/<timestamp>_rotation_and_history.sql` (nuevo)
- `src/lib/points.ts` (nuevo — constantes + `computeStatus`)
- `src/lib/periods.ts` (nuevo — helpers `periodKeyFor`, `periodRangeFor`)
- `src/routes/_authenticated/dashboard.tsx` (editado — navegación de semanas, instancias, assign-to-all, completar tarde)
- `src/hooks/use-task-reminders.ts` (ajuste menor si cambia forma de `myPending`)
- `src/integrations/supabase/types.ts` se regenera solo tras aprobar la migración.
