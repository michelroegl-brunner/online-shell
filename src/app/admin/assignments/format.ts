// Date helpers for the assignment UI. `datetime-local` inputs work in the
// browser's local time (Europe/Vienna for us); values are stored as UTC.

const pad = (n: number) => String(n).padStart(2, "0");

/** Date → "YYYY-MM-DDTHH:mm" in local time (for datetime-local inputs). */
export function toLocalInput(d: Date | null | undefined): string {
  if (!d) return "";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** "YYYY-MM-DDTHH:mm" (local) → Date, or null when empty/invalid. */
export function fromLocalInput(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmt = new Intl.DateTimeFormat("de-AT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatDateTime = (d: Date) => fmt.format(d);

/** "from … until …" summary of an assignment window. */
export function windowLabel(opensAt: Date | null, dueAt: Date | null) {
  if (!opensAt && !dueAt) return "Always open";
  if (opensAt && dueAt)
    return `${formatDateTime(opensAt)} – ${formatDateTime(dueAt)}`;
  if (dueAt) return `Due ${formatDateTime(dueAt)}`;
  return `From ${formatDateTime(opensAt!)}`;
}
