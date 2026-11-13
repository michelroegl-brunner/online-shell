import { z } from "zod";

/**
 * Ready-made checks for a step (client + server). A step passes when all of
 * them pass AND its check script passes (an empty script is skipped once
 * there are ready-made checks). Paths are relative to the exercise folder.
 *
 * - file_exists     a file / folder exists
 * - file_content    a file's content equals / contains / matches (grep -E, per line)
 * - command_output  output of a command run in the folder (stdout+stderr)
 * - command_used    the student ran a command matching a regex (command log)
 */

export const MATCH_MODES = ["exact", "contains", "regex"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

const message = z.string().trim().max(500).optional();
const path = z.string().trim().min(1, "Path is required").max(300);
const isValidRegex = (s: string) => {
  try {
    new RegExp(s);
    return true;
  } catch {
    return false;
  }
};

export const stepCheck = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file_exists"),
    path,
    kind: z.enum(["file", "dir"]).default("file"),
    message,
  }),
  z.object({
    type: z.literal("file_content"),
    path,
    match: z.enum(MATCH_MODES),
    value: z.string().max(10_000),
    message,
  }),
  z.object({
    type: z.literal("command_output"),
    command: z.string().trim().min(1, "Command is required").max(2000),
    match: z.enum(MATCH_MODES),
    value: z.string().max(10_000),
    message,
  }),
  z.object({
    type: z.literal("command_used"),
    pattern: z
      .string()
      .trim()
      .min(1, "Pattern is required")
      .max(500)
      .refine(isValidRegex, "Not a valid regular expression"),
    /** Only count commands that exited with 0. */
    successOnly: z.boolean().default(false),
    message,
  }),
]);

export type StepCheck = z.infer<typeof stepCheck>;
export type StepCheckType = StepCheck["type"];

export const stepChecks = z.array(stepCheck).max(20);

/** Lenient read of the DB JSON column: invalid entries are dropped. */
export function parseChecks(json: unknown): StepCheck[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((c) => {
    const r = stepCheck.safeParse(c);
    return r.success ? [r.data] : [];
  });
}

export const CHECK_TYPES: {
  type: StepCheckType;
  label: string;
  help: string;
}[] = [
  {
    type: "file_exists",
    label: "File exists",
    help: "A file or folder exists (path relative to the exercise folder).",
  },
  {
    type: "file_content",
    label: "File content",
    help: "A file's content equals / contains a text, or a line matches a regex (grep -E).",
  },
  {
    type: "command_output",
    label: "Command output",
    help: "Run a command in the exercise folder (as root, 10 s) and compare its output.",
  },
  {
    type: "command_used",
    label: "Command used",
    help: "The student typed a command matching this regex (JavaScript syntax) in their terminal.",
  },
];

export function newCheck(type: StepCheckType): StepCheck {
  switch (type) {
    case "file_exists":
      return { type, path: "", kind: "file" };
    case "file_content":
      return { type, path: "", match: "exact", value: "" };
    case "command_output":
      return { type, command: "", match: "exact", value: "" };
    case "command_used":
      return { type, pattern: "", successOnly: false };
  }
}

const MATCH_WORD: Record<MatchMode, string> = {
  exact: "is",
  contains: "contains",
  regex: "matches",
};

/** Short description, used as the "passed" line and default failure text. */
export function describeCheck(c: StepCheck): { ok: string; fail: string } {
  switch (c.type) {
    case "file_exists": {
      const what = c.kind === "dir" ? "Folder" : "File";
      return {
        ok: `${what} ${c.path} exists`,
        fail: `${what} ${c.path} does not exist yet.`,
      };
    }
    case "file_content":
      return {
        ok: `${c.path} ${MATCH_WORD[c.match]} what was asked`,
        fail: `${c.path} is not right yet.`,
      };
    case "command_output":
      return {
        ok: "The result is right",
        fail: "The result is not right yet.",
      };
    case "command_used":
      return {
        ok: "You used the expected command",
        fail: "You haven't used the expected command yet.",
      };
  }
}

/** Is a script empty apart from comments / blank lines / a shebang? */
export const isBlankScript = (s: string) =>
  s.split("\n").every((l) => l.trim() === "" || l.trim().startsWith("#"));
