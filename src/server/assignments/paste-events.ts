import "server-only";

import { z } from "zod";

import { SLUG_RE } from "~/lib/exercise";
import { db } from "~/server/db";
import { HOME } from "~/server/exercises/run";
import { assignmentWhereVisibleTo } from "./visibility";
import { windowState } from "./window";

/**
 * Why input was blocked. Browser: the terminal stopped a paste/drop/paste
 * shortcut. Runner: input reached the runner but looked pasted (bracketed
 * paste, a big chunk, faster than typing) — e.g. a modified client.
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

/** One batch of blocked attempts from one terminal (sent by the runner). */
export const pasteBatchSchema = z.object({
  userId: z.string().min(1).max(100),
  /** Start directory of the terminal (attach claim), if any. */
  cwd: z.string().max(500).optional(),
  firstAt: z.number().int().positive(),
  lastAt: z.number().int().positive(),
  count: z.number().int().positive().max(1_000_000),
  /** Bytes blocked (browser-side shortcuts don't know a size). */
  bytes: z.number().int().nonnegative().max(1_000_000_000),
  reasons: z.record(z.enum(PASTE_REASONS), z.number().int().nonnegative()),
});
export type PasteBatch = z.infer<typeof pasteBatchSchema>;

/** What ExamEvent.detail holds for type PASTE (JSON). */
export type PasteDetail = {
  count: number;
  bytes: number;
  reasons: Partial<Record<PasteReason, number>>;
  lastAt: string;
  /** Terminal it happened in: an exercise slug or "playground". */
  terminal: string;
};

export function parsePasteDetail(detail: string | null): PasteDetail | null {
  if (!detail) return null;
  try {
    const d = JSON.parse(detail) as Partial<PasteDetail>;
    return {
      count: typeof d.count === "number" ? d.count : 1,
      bytes: typeof d.bytes === "number" ? d.bytes : 0,
      reasons: d.reasons ?? {},
      lastAt: d.lastAt ?? "",
      terminal: d.terminal ?? "",
    };
  } catch {
    return null;
  }
}

function slugOf(cwd: string | undefined) {
  const prefix = `${HOME}/exercises/`;
  if (!cwd?.startsWith(prefix)) return null;
  const slug = cwd.slice(prefix.length).split("/")[0] ?? "";
  return SLUG_RE.test(slug) ? slug : null;
}

/**
 * Store a batch of blocked paste attempts as an ExamEvent (type PASTE).
 *
 * Pasting is blocked per student while a no-paste assignment is open, so
 * the event belongs to that assignment: to the attempt for the exercise the
 * terminal was opened in, otherwise (playground, other folder) to the
 * student's most recently active attempt in an open no-paste assignment.
 * Without any such attempt (nothing opened yet) there is nowhere to show
 * it, so it is dropped. Returns the attempt id or null.
 */
export async function recordPasteBatch(b: PasteBatch) {
  const at = new Date(b.firstAt);
  const assignments = await db.assignment.findMany({
    where: {
      AND: [assignmentWhereVisibleTo(b.userId), { allowPaste: false }],
    },
    select: {
      opensAt: true,
      dueAt: true,
      extensions: {
        where: { userId: b.userId },
        select: { extraMinutes: true },
      },
      items: {
        select: {
          exercise: { select: { slug: true } },
          attempts: {
            where: { userId: b.userId },
            select: { id: true, updatedAt: true },
          },
        },
      },
    },
  });
  const candidates = assignments
    .filter((a) => windowState(a, a.extensions[0]?.extraMinutes, at) === "open")
    .flatMap((a) =>
      a.items.flatMap((i) =>
        i.attempts.map((t) => ({ ...t, slug: i.exercise.slug })),
      ),
    );
  if (candidates.length === 0) return null;

  const slug = slugOf(b.cwd);
  const attempt =
    candidates.find((c) => c.slug === slug) ??
    candidates.reduce((x, y) => (y.updatedAt > x.updatedAt ? y : x));

  const detail: PasteDetail = {
    count: b.count,
    bytes: b.bytes,
    reasons: b.reasons,
    lastAt: new Date(b.lastAt).toISOString(),
    terminal: slug ?? "playground",
  };
  await db.examEvent.create({
    data: {
      attemptId: attempt.id,
      at,
      type: "PASTE",
      detail: JSON.stringify(detail),
    },
  });
  return attempt.id;
}
