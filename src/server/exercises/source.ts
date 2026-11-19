import "server-only";

import { TRPCError } from "@trpc/server";

import { readFile } from "~/server/files";
import { runner } from "~/server/runner";

/**
 * Code editor of C exercises: the source files in ~/exercises/<slug>.
 * Everything runs AS THE STUDENT in their box (like the file browser);
 * paths are validated here and passed base64-encoded.
 */

/** "main.c", "src/list.h", "Makefile": one optional sub folder. */
export const SOURCE_PATH_RE =
  /^(?:[A-Za-z0-9_][\w.-]{0,60}\/)?(?:[A-Za-z0-9_][\w.-]{0,60}\.[ch]|[Mm]akefile)$/;

/** Bigger files are edited in the terminal (the editor is for exercises). */
export const MAX_SOURCE_BYTES = 100_000;
const MAX_FILES = 30;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const dirOf = (slug: string) => `exercises/${slug}`;

export function assertSourcePath(path: string) {
  if (!SOURCE_PATH_RE.test(path) || path.split("/").includes("..")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Use a name like main.c, list.h or Makefile (letters, digits, . - _; at most one folder).",
    });
  }
}

/** The editable files (.c / .h / Makefile, up to one folder deep). */
export async function listSources(userId: string, slug: string) {
  const res = await runner.exec(userId, {
    user: "student",
    timeoutMs: 15_000,
    script: [
      `d="/home/student/$(printf '%s' '${b64(dirOf(slug))}' | base64 -d)"`,
      '[ -d "$d" ] || exit 3',
      `find "$d" -mindepth 1 -maxdepth 2 -type f \\( -name '*.c' -o -name '*.h' -o -name Makefile -o -name makefile \\) -not -path '*/.*' -printf '%P\\t%s\\0' 2>/dev/null | head -z -n ${MAX_FILES}`,
    ].join("\n"),
  });
  if (res.exitCode === 3) return [];
  return res.stdout
    .split("\0")
    .filter(Boolean)
    .flatMap((line) => {
      const [path, size] = line.split("\t");
      if (!path || !SOURCE_PATH_RE.test(path)) return [];
      return [{ path, size: Number(size) || 0 }];
    })
    .sort(
      (a, b) =>
        Number(b.path === "main.c") - Number(a.path === "main.c") ||
        a.path.localeCompare(b.path),
    );
}

export async function readSource(userId: string, slug: string, path: string) {
  assertSourcePath(path);
  const f = await readFile(userId, `${dirOf(slug)}/${path}`);
  if (f.text === null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This file isn't text — open it in the terminal.",
    });
  }
  return { path, text: f.text, truncated: f.truncated, size: f.size };
}

/** Write a file (atomically: temp file + mv). Creates one sub folder. */
export async function saveSource(
  userId: string,
  slug: string,
  path: string,
  text: string,
) {
  assertSourcePath(path);
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
      `printf '%s' '${b64(text)}' | base64 -d > "$p.oshell-save" && mv -f -- "$p.oshell-save" "$p" || exit 4`,
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
