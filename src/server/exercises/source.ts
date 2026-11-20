import "server-only";

import { TRPCError } from "@trpc/server";

import { readFile } from "~/server/files";
import { runner } from "~/server/runner";
import type { ShellKind } from "~/lib/shell";

/**
 * Code editor of exercises: the source files in ~/exercises/<slug> — C
 * sources (.c / .h / Makefile) or scripts (.sh for bash, .ps1 for
 * PowerShell). Everything runs AS THE STUDENT in their box (like the file
 * browser); paths are validated here and passed base64-encoded.
 */

const DIR = String.raw`(?:[A-Za-z0-9_][\w.-]{0,60}\/)?`;
const NAME = String.raw`[A-Za-z0-9_][\w.-]{0,60}`;

/** Which files the editor shows and saves, per exercise shell. */
const SOURCE_KINDS = {
  C: {
    /** "main.c", "src/list.h", "Makefile": one optional sub folder. */
    re: new RegExp(String.raw`^${DIR}(?:${NAME}\.[ch]|[Mm]akefile)$`),
    find: String.raw`\( -name '*.c' -o -name '*.h' -o -name Makefile -o -name makefile \)`,
    first: "main.c",
    hint: "Use a name like main.c, list.h or Makefile (letters, digits, . - _; at most one folder).",
  },
  BASH: {
    re: new RegExp(String.raw`^${DIR}${NAME}\.sh$`),
    find: "-name '*.sh'",
    first: "",
    hint: "Use a name like script.sh (letters, digits, . - _; at most one folder).",
  },
  PWSH: {
    re: new RegExp(String.raw`^${DIR}${NAME}\.ps1$`),
    find: "-name '*.ps1'",
    first: "",
    hint: "Use a name like script.ps1 (letters, digits, . - _; at most one folder).",
  },
} satisfies Record<ShellKind, unknown>;

/** Bigger files are edited in the terminal (the editor is for exercises). */
export const MAX_SOURCE_BYTES = 100_000;
const MAX_FILES = 30;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const dirOf = (slug: string) => `exercises/${slug}`;

export function assertSourcePath(kind: ShellKind, path: string) {
  if (!SOURCE_KINDS[kind].re.test(path) || path.split("/").includes("..")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: SOURCE_KINDS[kind].hint,
    });
  }
}

/** The editable files (up to one folder deep). */
export async function listSources(
  userId: string,
  kind: ShellKind,
  slug: string,
) {
  const k = SOURCE_KINDS[kind];
  const res = await runner.exec(userId, {
    user: "student",
    timeoutMs: 15_000,
    script: [
      `d="/home/student/$(printf '%s' '${b64(dirOf(slug))}' | base64 -d)"`,
      '[ -d "$d" ] || exit 3',
      `find "$d" -mindepth 1 -maxdepth 2 -type f ${k.find} -not -path '*/.*' -printf '%P\t%s\0' 2>/dev/null | head -z -n ${MAX_FILES}`,
    ].join("\n"),
  });
  if (res.exitCode === 3) return [];
  return res.stdout
    .split("\0")
    .filter(Boolean)
    .flatMap((line) => {
      const [path, size] = line.split("\t");
      if (!path || !k.re.test(path)) return [];
      return [{ path, size: Number(size) || 0 }];
    })
    .sort(
      (a, b) =>
        Number(b.path === k.first) - Number(a.path === k.first) ||
        // Top-level files before the ones in a sub folder.
        Number(a.path.includes("/")) - Number(b.path.includes("/")) ||
        a.path.localeCompare(b.path),
    );
}

export async function readSource(
  userId: string,
  kind: ShellKind,
  slug: string,
  path: string,
) {
  assertSourcePath(kind, path);
  const f = await readFile(userId, `${dirOf(slug)}/${path}`);
  if (f.text === null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This file isn't text — open it in the terminal.",
    });
  }
  return { path, text: f.text, truncated: f.truncated, size: f.size };
}

/**
 * Write a file (atomically: temp file + mv). Creates one sub folder. Keeps
 * the file's mode (a script the student made executable stays so).
 */
export async function saveSource(
  userId: string,
  kind: ShellKind,
  slug: string,
  path: string,
  text: string,
) {
  assertSourcePath(kind, path);
  if (Buffer.byteLength(text, "utf8") > MAX_SOURCE_BYTES) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The file is too big for the editor (100 KB).",
    });
  }
  const res = await runner.exec(userId, {
    user: "student",
    timeoutMs: 15_000,
    script: [
      `d="/home/student/$(printf '%s' '${b64(dirOf(slug))}' | base64 -d)"`,
      '[ -d "$d" ] || exit 3',
      `p="$d/$(printf '%s' '${b64(path)}' | base64 -d)"`,
      'mkdir -p -- "$(dirname -- "$p")" || exit 4',
      `printf '%s' '${b64(text)}' | base64 -d > "$p.oshell-save" || exit 4`,
      '[ -e "$p" ] && chmod --reference="$p" -- "$p.oshell-save" 2>/dev/null',
      'mv -f -- "$p.oshell-save" "$p" || exit 4',
    ].join("\n"),
  });
  if (res.exitCode === 3) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The exercise folder is missing — press Reset.",
    });
  }
  if (res.exitCode !== 0) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Saving failed. Try again, or tell your teacher.",
    });
  }
  return { path, savedAt: Date.now() };
}

// ── no-paste assignments: saves must look typed ──

/**
 * While pasting is off for a student, the editor blocks paste/drop — but
 * that's the browser. Here the server checks every save: the newly inserted
 * text (new file minus the part it shares with the stored one at start and
 * end) must fit a typing budget like the terminal's (runner: 40 bytes/s).
 *
 * One budget PER STUDENT (all files: a new file name is no fresh budget).
 * Saves are batched (auto-save after a pause), so unused budget piles up to
 * MAX_BUDGET (≈ 20 s of typing). A student the server hasn't seen yet
 * starts with START_BUDGET only. A refused save doesn't use up anything,
 * so the budget keeps growing until the save fits (or the student undoes
 * the paste). Saves of one student are checked one after another. Per web
 * process, in memory (there is one web container).
 */
const RATE_PER_SEC = 40;
const MAX_BUDGET = 800;
const START_BUDGET = 200;
const REPORT_EVERY_MS = 30_000;
/** After this long a student has MAX_BUDGET anyway; dropping them is safe. */
const FULL_AFTER_MS = (MAX_BUDGET / RATE_PER_SEC) * 1000;

const budgets = new Map<string, { at: number; reportedAt: number }>();
const queues = new Map<string, Promise<unknown>>();

/** Characters inserted going from `before` to `after` (a replace counts its new text). */
export function insertedChars(before: string, after: string) {
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before[p] === after[p]) p++;
  let s = 0;
  while (
    s < max - p &&
    before[before.length - 1 - s] === after[after.length - 1 - s]
  ) {
    s++;
  }
  return Math.max(0, after.length - p - s);
}

/** Run `fn` after the student's previous budget check has finished. */
function oneAtATime<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(userId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  queues.set(userId, tail);
  void tail.then(() => {
    if (queues.get(userId) === tail) queues.delete(userId);
  });
  return run;
}

/** Forget students whose budget is full anyway (they'd get less, not more). */
function prune(now: number) {
  if (budgets.size < 1000) return;
  for (const [k, b] of budgets) {
    if (now - b.at > FULL_AFTER_MS && now - b.reportedAt > REPORT_EVERY_MS) {
      budgets.delete(k);
    }
  }
}

/**
 * Throws when the save inserts more than the typing budget allows; calls
 * `report` (at most every 30 s per student) so the teacher sees it.
 */
export function assertTyped(
  userId: string,
  kind: ShellKind,
  slug: string,
  path: string,
  text: string,
  report: (chars: number) => Promise<void>,
) {
  return oneAtATime(userId, async () => {
    let before = "";
    try {
      before = (await readSource(userId, kind, slug, path)).text;
    } catch (e) {
      // A new file starts empty; anything else is a real error.
      if (!(e instanceof TRPCError && e.code === "NOT_FOUND")) throw e;
    }
    const chars = insertedChars(before, text);
    const now = Date.now();
    prune(now);
    const b = budgets.get(userId) ?? {
      at: now - (START_BUDGET / RATE_PER_SEC) * 1000,
      reportedAt: 0,
    };
    const budget = Math.min(MAX_BUDGET, ((now - b.at) / 1000) * RATE_PER_SEC);
    if (chars <= budget) {
      // Keep what wasn't used (up to the cap) for the next save.
      const left = budget - chars;
      budgets.set(userId, {
        ...b,
        at: now - (left / RATE_PER_SEC) * 1000,
      });
      return;
    }
    budgets.set(userId, b);
    if (now - b.reportedAt > REPORT_EVERY_MS) {
      budgets.set(userId, { ...b, reportedAt: now });
      await report(chars).catch((e: unknown) =>
        console.error("[source] paste report failed", e),
      );
    }
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Pasting is turned off for your current assignment — this change wasn't saved. Undo the pasted text (Ctrl+Z) and type it.",
    });
  });
}
