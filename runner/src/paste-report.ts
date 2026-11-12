import { config } from "./config.js";

/**
 * Reports blocked paste attempts of one terminal connection to the web app
 * (POST {WEB_URL}/api/runner/paste-events), which stores them as ExamEvents
 * for the teacher. Attempts are batched: the first one opens a window of
 * FLUSH_MS, everything blocked within it becomes one report, so a paste
 * that is dropped frame by frame is still one entry. Best effort: if the
 * web app is unreachable the batch is logged and dropped.
 */
export const PASTE_REASONS = [
  "paste",
  "drop",
  "shortcut",
  "bracketed",
  "chunk",
  "speed",
] as const;
export type PasteReason = (typeof PASTE_REASONS)[number];

const FLUSH_MS = 10_000;

type Batch = {
  firstAt: number;
  lastAt: number;
  count: number;
  bytes: number;
  reasons: Partial<Record<PasteReason, number>>;
};

export function pasteReporter(userId: string, cwd: string | undefined) {
  let batch: Batch | null = null;
  let timer: NodeJS.Timeout | undefined;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const b = batch;
    batch = null;
    if (!b) return;
    const body = JSON.stringify({ userId, cwd, ...b });
    fetch(`${config.WEB_URL}/api/runner/paste-events`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.RUNNER_SECRET}`,
        "content-type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    }).then(
      (res) => {
        if (!res.ok) {
          console.error(`[paste-report] web app → ${res.status}`, body);
        }
      },
      (err: unknown) => console.error("[paste-report] failed", err, body),
    );
  };

  return {
    /** One blocked attempt (a paste event, or one dropped input frame). */
    add(reason: PasteReason, bytes: number) {
      const now = Date.now();
      batch ??= { firstAt: now, lastAt: now, count: 0, bytes: 0, reasons: {} };
      // Dropped frames of one burst count as one attempt per reason+second.
      const sameBurst =
        reason === "speed" &&
        (batch.reasons.speed ?? 0) > 0 &&
        now - batch.lastAt < 1000;
      if (!sameBurst) {
        batch.count += 1;
        batch.reasons[reason] = (batch.reasons[reason] ?? 0) + 1;
      }
      batch.lastAt = now;
      batch.bytes += bytes;
      timer ??= setTimeout(flush, FLUSH_MS);
    },
    /** Send what is pending now (connection closed). */
    flush,
  };
}
