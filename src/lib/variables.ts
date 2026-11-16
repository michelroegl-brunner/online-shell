import { z } from "zod";

/**
 * Per-student exercise variables (client + server).
 *
 * An exercise may define variables; every student gets their own values
 * when they open the exercise (stored on the attempt), so neighbours can't
 * simply copy each other's answers.
 *
 * - In the exercise / step descriptions, hints and ready-made checks:
 *   `{{NAME}}` is replaced with the value.
 * - In setup and check scripts: `$NAME` (bash) / `$env:NAME` (pwsh) — the
 *   values are exported as environment variables.
 *
 * Values are picked deterministically from a seed (the attempt id), so a
 * re-run gives the same values.
 */

export const VAR_NAME_RE = /^[A-Z][A-Z0-9_]{0,30}$/;

/** Names the scripts rely on; a variable must not shadow them. */
const RESERVED = new Set([
  "HOME",
  "PATH",
  "PWD",
  "OLDPWD",
  "USER",
  "SHELL",
  "TERM",
  "LANG",
  "IFS",
  "PS1",
  "PS2",
  "NO_COLOR",
  "PSMODULEPATH",
  "D",
]);

export const VARIABLE_KINDS = ["int", "choice", "word"] as const;
export type VariableKind = (typeof VARIABLE_KINDS)[number];

const name = z
  .string()
  .trim()
  .regex(VAR_NAME_RE, "Use UPPER_CASE letters, digits and _")
  .refine((n) => !RESERVED.has(n) && !n.startsWith("OSHELL_"), {
    message: "This name is reserved",
  });

export const variableDef = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("int"),
    name,
    min: z.number().int().min(-1_000_000_000).max(1_000_000_000),
    max: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  }),
  z.object({
    kind: z.literal("choice"),
    name,
    choices: z
      .array(z.string().max(200))
      .min(1, "Add at least one choice")
      .max(100),
  }),
  z.object({
    kind: z.literal("word"),
    name,
  }),
]);

export type VariableDef = z.infer<typeof variableDef>;

export const variableDefs = z
  .array(variableDef)
  .max(20)
  .refine((vs) => new Set(vs.map((v) => v.name)).size === vs.length, {
    message: "Variable names must be unique",
  })
  .refine((vs) => vs.every((v) => v.kind !== "int" || v.min <= v.max), {
    message: "A number variable's min must be ≤ its max",
  });

export type Vars = Record<string, string>;

/** Lenient read of the DB JSON column: invalid entries are dropped. */
export function parseVariables(json: unknown): VariableDef[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((v) => {
    const r = variableDef.safeParse(v);
    return r.success ? [r.data] : [];
  });
}

/** Lenient read of Attempt.vars. */
export function parseVars(json: unknown): Vars {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const out: Vars = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (VAR_NAME_RE.test(k) && typeof v === "string") out[k] = v;
  }
  return out;
}

/** Harmless, easy-to-type words for `word` variables. */
export const WORDS = [
  "apfel",
  "birne",
  "kiwi",
  "mango",
  "zitrone",
  "melone",
  "dattel",
  "feige",
  "ahorn",
  "birke",
  "eiche",
  "linde",
  "tanne",
  "buche",
  "erle",
  "pappel",
  "adler",
  "biber",
  "dachs",
  "falke",
  "fuchs",
  "igel",
  "luchs",
  "otter",
  "rabe",
  "wolf",
  "zebra",
  "panda",
  "koala",
  "tiger",
  "lama",
  "yak",
  "atlas",
  "comet",
  "delta",
  "echo",
  "gamma",
  "kappa",
  "lambda",
  "sigma",
  "nordsee",
  "donau",
  "inn",
  "salzach",
  "traun",
  "enns",
  "mur",
  "drau",
  "granit",
  "quarz",
  "basalt",
  "marmor",
  "kobalt",
  "titan",
  "zink",
  "neon",
] as const;

/** FNV-1a → 32-bit seed. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small deterministic PRNG in [0, 1). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick values for all variables, deterministic for a seed. */
export function generateVars(defs: VariableDef[], seed: string): Vars {
  const out: Vars = {};
  for (const d of defs) {
    // One stream per variable: adding a variable keeps the others' values.
    const r = rng(hash(`${seed}:${d.name}`));
    switch (d.kind) {
      case "int":
        out[d.name] = String(d.min + Math.floor(r() * (d.max - d.min + 1)));
        break;
      case "choice":
        out[d.name] = d.choices[Math.floor(r() * d.choices.length)] ?? "";
        break;
      case "word":
        out[d.name] = WORDS[Math.floor(r() * WORDS.length)]!;
        break;
    }
  }
  return out;
}

/**
 * Values for an attempt: the stored ones, plus values for variables added
 * after the attempt started (kept stable by the seed).
 */
export function varsFor(defs: VariableDef[], stored: unknown, seed: string) {
  const have = parseVars(stored);
  const fresh = generateVars(defs, seed);
  const out: Vars = {};
  for (const d of defs) out[d.name] = have[d.name] ?? fresh[d.name]!;
  return out;
}

const PLACEHOLDER = /\{\{\s*([A-Z][A-Z0-9_]{0,30})\s*\}\}/g;

/** Replace `{{NAME}}` with the value; unknown names stay as they are. */
export function renderVars(text: string, vars: Vars): string {
  if (!text.includes("{{")) return text;
  return text.replace(PLACEHOLDER, (m, n: string) => vars[n] ?? m);
}

/** Placeholders used in a text (for the editor's warnings). */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!);
}

/** Short description of a variable for the editor / reports. */
export function describeVariable(d: VariableDef) {
  switch (d.kind) {
    case "int":
      return `number ${d.min}…${d.max}`;
    case "choice":
      return `one of ${d.choices.length}`;
    case "word":
      return "random word";
  }
}

/** Example values (what a test run uses: a fixed seed). */
export const PREVIEW_SEED = "preview";
