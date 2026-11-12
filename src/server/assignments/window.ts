/**
 * Time window of an assignment for one student (edge/client-safe, no DB).
 * A per-student extension (AssignmentExtension.extraMinutes) moves dueAt.
 */
export type WindowState = "upcoming" | "open" | "closed";

export function effectiveDueAt(
  dueAt: Date | null,
  extraMinutes: number | undefined,
): Date | null {
  if (!dueAt) return null;
  return new Date(dueAt.getTime() + (extraMinutes ?? 0) * 60_000);
}

export function windowState(
  a: { opensAt: Date | null; dueAt: Date | null },
  extraMinutes?: number,
  now = new Date(),
): WindowState {
  if (a.opensAt && now < a.opensAt) return "upcoming";
  const due = effectiveDueAt(a.dueAt, extraMinutes);
  if (due && now > due) return "closed";
  return "open";
}
