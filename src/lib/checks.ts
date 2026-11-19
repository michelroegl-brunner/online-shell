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
 * - c_tests         compile a C file with gcc and run it on test cases
 *                   (stdin → expected stdout); runs as the student user
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

/** One test case of a c_tests check. */
export const cTestCase = z.object({
  /** Shown in the result line; default "Test n". */
  name: z.string().trim().max(100).default(""),
  /** Command-line arguments (split like a shell would, no expansion). */
  args: z.string().max(1000).default(""),
  stdin: z.string().max(10_000).default(""),
  match: z.enum(MATCH_MODES).default("exact"),
  expected: z.string().max(10_000),
  /** Hidden: the student sees pass/fail only, not input and output. */
  hidden: z.boolean().default(false),
  /** Expected return value of main (null = any). */
  exitCode: z.number().int().min(0).max(255).nullable().default(null),
});
export type CTestCase = z.infer<typeof cTestCase>;

export const DEFAULT_GCC_FLAGS = "-std=c11 -Wall -Wextra";

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
  z.object({
    type: z.literal("c_tests"),
    /** Source files (space separated), relative to the exercise folder. */
    files: z
      .string()
      .trim()
      .min(1, "Source file is required")
      .max(300)
      .regex(/^[\w./ -]+$/, "Letters, digits, . / - _ and spaces only")
      .refine(
        (s) =>
          !s
            .split(/\s+/)
            .some((f) => f.startsWith("/") || f.split("/").includes("..")),
        "Paths must stay inside the exercise folder",
      )
      .refine(
        (s) => !s.split(/\s+/).some((f) => f.startsWith("-")),
        "File names can't start with -",
      ),
    flags: z
      .string()
      .trim()
      .max(300)
      .regex(
        /^[\w=+.,:/ -]*$/,
        "Only plain gcc flags (no quotes or shell characters)",
      )
      .default(DEFAULT_GCC_FLAGS),
    /** Compiler warnings fail the check (-Werror). */
    noWarnings: z.boolean().default(false),
    /** Seconds per test case. */
    timeout: z.number().int().min(1).max(10).default(2),
    cases: z.array(cTestCase).min(1, "Add at least one test case").max(30),
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
  {
    type: "c_tests",
    label: "C test cases",
    help: "Compile C files with gcc (as the student), then run the program on each test case: arguments + stdin → expected stdout.",
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
    case "c_tests":
      return {
        type,
        files: "main.c",
        flags: DEFAULT_GCC_FLAGS,
        noWarnings: false,
        timeout: 2,
        cases: [newCTestCase()],
      };
  }
}

export const newCTestCase = (): CTestCase => ({
  name: "",
  args: "",
  stdin: "",
  match: "exact",
  expected: "",
  hidden: false,
  exitCode: null,
});

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
    case "c_tests":
      return {
        ok: "All test cases pass",
        fail: "Not all test cases pass yet.",
      };
  }
}

/** Is a script empty apart from comments / blank lines / a shebang? */
export const isBlankScript = (s: string) =>
  s.split("\n").every((l) => l.trim() === "" || l.trim().startsWith("#"));

/**
 * Split a test case's argument line like a shell would, without any
 * expansion: whitespace separates, '…' and "…" quote, \ escapes.
 */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let has = false;
  let q: "'" | '"' | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === q) q = null;
      else if (ch === "\\" && q === '"' && i + 1 < line.length)
        cur += line[++i];
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      q = ch;
      has = true;
    } else if (ch === "\\" && i + 1 < line.length) {
      cur += line[++i];
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else cur += ch;
  }
  if (has || cur) out.push(cur);
  return out;
}
