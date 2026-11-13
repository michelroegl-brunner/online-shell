import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parseFrontmatter } from "./frontmatter";
import { cheatSheetInput, type CheatSheetInput } from "./schema";

/**
 * Built-in cheat sheets: Markdown files with frontmatter in
 * content/cheatsheets/*.md, read at runtime (the Docker image copies
 * `content/` to /app/content, the working directory of the server).
 */
export const BUILTIN_DIR = path.join(process.cwd(), "content", "cheatsheets");

export type BuiltinSheet = Omit<CheatSheetInput, "visibility">;

/** Parse one file; throws with the file name on invalid frontmatter. */
export function parseBuiltin(file: string, src: string): BuiltinSheet {
  const { data, body } = parseFrontmatter(src);
  const tags = data.tags;
  const parsed = cheatSheetInput.safeParse({
    title: data.title,
    slug: data.slug ?? path.basename(file, ".md"),
    shell: typeof data.shell === "string" ? data.shell.toUpperCase() : "BASH",
    tags: Array.isArray(tags)
      ? tags
      : typeof tags === "string"
        ? tags.split(",")
        : [],
    body,
    order: Number(data.order ?? 0),
    visibility: "SHARED",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `${file}: ${issue?.path.length ? issue.path.join(".") : "file"}: ${issue?.message}`,
    );
  }
  const { title, slug, shell, tags: t, body: b, order } = parsed.data;
  return { title, slug, shell, tags: t, body: b, order };
}

export async function loadBuiltinSheets(): Promise<BuiltinSheet[]> {
  let files: string[];
  try {
    files = (await readdir(BUILTIN_DIR)).filter(
      (f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md",
    );
  } catch {
    return [];
  }
  files.sort();
  return Promise.all(
    files.map(async (f) =>
      parseBuiltin(f, await readFile(path.join(BUILTIN_DIR, f), "utf8")),
    ),
  );
}
