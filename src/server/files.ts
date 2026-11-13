import "server-only";

import { TRPCError } from "@trpc/server";

import { isAdmin, type Viewer } from "~/server/access";
import { type db as dbType } from "~/server/db";
import { runner } from "~/server/runner";

/**
 * Home file browser. Everything runs inside the owner's box AS THE STUDENT
 * user (so only what the student can read), with the path passed base64-
 * encoded (no quoting issues). Paths are relative to /home/student.
 */

type Db = typeof dbType;

export const HOME = "/home/student";

/** "a/b/c" (no leading slash, no `.`/`..`), "" = home. Throws otherwise. */
export function normalizeRel(raw: string): string {
  const segs = raw.split("/").filter(Boolean);
  if (segs.some((s) => s === "." || s === ".." || s.includes("\0"))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid path." });
  }
  return segs.join("/");
}

export const absPath = (rel: string) => (rel ? `${HOME}/${rel}` : HOME);

/**
 * May `viewer` see `ownerId`'s files? Yes for the owner, admins, and
 * teachers of a class the owner is a member of.
 */
export async function canSeeFiles(db: Db, viewer: Viewer, ownerId: string) {
  if (viewer.id === ownerId || isAdmin(viewer)) return true;
  if (viewer.role !== "TEACHER") return false;
  const m = await db.classMembership.findFirst({
    where: {
      userId: ownerId,
      class: { teachers: { some: { userId: viewer.id } } },
    },
    select: { classId: true },
  });
  return m !== null;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const pathVar = (rel: string) =>
  `p="$(printf '%s' '${b64(absPath(rel))}' | base64 -d)"`;

export type FileEntry = {
  name: string;
  /** d = folder, f = file, l = symlink, o = other */
  type: "d" | "f" | "l" | "o";
  size: number;
  mtime: number;
};

const MAX_ENTRIES = 1000;

export async function listDir(ownerId: string, rel: string) {
  await runner.ensureBox(ownerId);
  const res = await runner.exec(ownerId, {
    user: "student",
    timeoutMs: 15_000,
    script: [
      pathVar(rel),
      '[ -d "$p" ] || exit 3',
      `find "$p" -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\0' 2>/dev/null | head -z -n ${MAX_ENTRIES + 1}`,
    ].join("\n"),
  });
  if (res.exitCode === 3) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found." });
  }
  const entries: FileEntry[] = res.stdout
    .split("\0")
    .filter(Boolean)
    .flatMap((line) => {
      const [y, size, mtime, ...name] = line.split("\t");
      if (!y || name.length === 0) return [];
      return [
        {
          name: name.join("\t"),
          type: (["d", "f", "l"].includes(y) ? y : "o") as FileEntry["type"],
          size: Number(size) || 0,
          mtime: Math.round(Number(mtime) * 1000) || 0,
        },
      ];
    });
  const truncated = entries.length > MAX_ENTRIES;
  entries.length = Math.min(entries.length, MAX_ENTRIES);
  entries.sort(
    (a, b) =>
      Number(b.type === "d") - Number(a.type === "d") ||
      a.name.localeCompare(b.name),
  );
  return { path: rel, entries, truncated };
}

/** Preview size (the runner caps exec output at 64 KB, base64 included). */
const PREVIEW_BYTES = 40_000;

export async function readFile(ownerId: string, rel: string) {
  await runner.ensureBox(ownerId);
  const res = await runner.exec(ownerId, {
    user: "student",
    timeoutMs: 15_000,
    script: [
      pathVar(rel),
      '[ -f "$p" ] && [ -r "$p" ] || exit 3',
      'stat -c %s -- "$p"',
      `head -c ${PREVIEW_BYTES} -- "$p" | base64 -w0`,
    ].join("\n"),
  });
  if (res.exitCode === 3) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "File not found or not readable.",
    });
  }
  const nl = res.stdout.indexOf("\n");
  const size = Number(res.stdout.slice(0, nl)) || 0;
  const bytes = Buffer.from(res.stdout.slice(nl + 1).trim(), "base64");
  let text: string | null = null;
  if (!bytes.includes(0)) {
    try {
      // A cut-off multi-byte char at the end is fine (stream: true).
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, {
        stream: size > bytes.length,
      });
    } catch {
      text = null;
    }
  }
  return { path: rel, size, text, truncated: size > bytes.length };
}
