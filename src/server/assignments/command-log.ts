import "server-only";

import { SLUG_RE } from "~/lib/exercise";
import { db } from "~/server/db";
import { HOME } from "~/server/exercises/run";
import { runner } from "~/server/runner";

/**
 * Pull the command log out of a student's box and store it.
 *
 * The bash hook in the box appends `epoch\texit\tcwd\tcommand` lines to
 * /run/oshell/cmd.log. We rotate the file (mv + fresh file; a shell that
 * still has the old inode open keeps appending to the moved file, which we
 * read afterwards), then attribute each line to an attempt by its working
 * directory: anything under ~/exercises/<slug> belongs to the student's
 * most recently active attempt for that exercise. Commands outside an
 * exercise folder (e.g. the playground) are dropped.
 *
 * Best effort: a missing box or runner error just means nothing to ingest.
 * The log is written by the student's shell, so it is a learning aid, not
 * an audit trail.
 */
export async function ingestCommandLog(userId: string): Promise<number> {
  let raw: string;
  try {
    const res = await runner.exec(userId, {
      user: "root",
      timeoutMs: 10_000,
      script: [
        "f=/run/oshell/cmd.log",
        '[ -s "$f" ] || exit 0',
        'mv -- "$f" "$f.ingest" || exit 0',
        'touch -- "$f" && chown student:student -- "$f"',
        'cat -- "$f.ingest"',
        'rm -f -- "$f.ingest"',
      ].join("\n"),
    });
    if (res.exitCode !== 0) return 0;
    raw = res.stdout;
  } catch {
    return 0; // no box (yet) / runner down
  }

  const prefix = `${HOME}/exercises/`;
  const bySlug = new Map<
    string,
    { at: Date; exitCode: number | null; cwd: string; command: string }[]
  >();

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [epoch, exit, cwd, ...rest] = line.split("\t");
    const command = rest.join("\t").trim();
    if (!epoch || !cwd || !command) continue;
    if (!cwd.startsWith(prefix)) continue;
    const slug = cwd.slice(prefix.length).split("/")[0] ?? "";
    if (!SLUG_RE.test(slug)) continue;
    const at = new Date(Number(epoch) * 1000);
    const exitCode = Number.parseInt(exit ?? "", 10);
    const list = bySlug.get(slug) ?? [];
    list.push({
      at: Number.isNaN(at.getTime()) ? new Date() : at,
      exitCode: Number.isNaN(exitCode) ? null : exitCode,
      cwd,
      command: command.slice(0, 4000),
    });
    bySlug.set(slug, list);
  }
  if (bySlug.size === 0) return 0;

  const attempts = await db.attempt.findMany({
    where: {
      userId,
      assignmentItem: { exercise: { slug: { in: [...bySlug.keys()] } } },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      assignmentItem: { select: { exercise: { select: { slug: true } } } },
    },
  });
  const attemptBySlug = new Map<string, string>();
  for (const a of attempts) {
    const slug = a.assignmentItem.exercise.slug;
    if (!attemptBySlug.has(slug)) attemptBySlug.set(slug, a.id);
  }

  const data = [...bySlug.entries()].flatMap(([slug, rows]) => {
    const attemptId = attemptBySlug.get(slug);
    return attemptId ? rows.map((r) => ({ ...r, attemptId })) : [];
  });
  if (data.length > 0) await db.commandLog.createMany({ data });
  return data.length;
}
