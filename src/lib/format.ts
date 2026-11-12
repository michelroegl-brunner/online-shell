// Dates are stored in UTC; the school is in Austria.
const TZ = "Europe/Vienna";

const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatDateTime = (d: Date | string | null | undefined) =>
  d ? dateTime.format(new Date(d)) : "";

/** True if `d` is in the future but less than `ms` away. */
export const isWithin = (d: Date | string, ms: number, now = new Date()) => {
  const diff = new Date(d).getTime() - now.getTime();
  return diff >= 0 && diff < ms;
};

/** "in 3 days", "2 hours ago", … */
export function relativeTime(d: Date | string, now = new Date()) {
  const diff = new Date(d).getTime() - now.getTime();
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "minute") {
      return rtf.format(Math.round(diff / ms), unit);
    }
  }
  return "";
}
