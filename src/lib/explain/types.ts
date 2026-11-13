/** Types for the command explainer (pure, shared by server and tests). */

export type Shell = "BASH" | "PWSH";

export type Explanation = {
  /** Rule id, e.g. "fn-call-parens". */
  id: string;
  /** Short German headline. */
  title: string;
  /** Markdown, German, du-form: 1–3 sentences + optional tiny example. */
  detail: string;
  /** Corrected command, only when it can be derived confidently. */
  fix?: string;
};

export type ExplainInput = {
  command: string;
  exitCode: number | null;
  shell: Shell;
  /** Functions the student defined earlier (in this attempt). */
  knownFunctions?: string[];
  /** Earlier commands, oldest first (without `command` itself). */
  history?: string[];
};

/** A word of the command line with its position. */
export type Token = {
  /** Original text (quotes kept). */
  text: string;
  /** Same text with the contents of quotes masked. */
  masked: string;
  start: number;
  end: number;
};

/** What every rule gets to look at. */
export type Ctx = {
  /** The command, trimmed. */
  command: string;
  /** `command` with string contents replaced by "_" (same length). */
  masked: string;
  /** Quote left open at the end of the line, if any. */
  unclosedQuote: '"' | "'" | null;
  exitCode: number | null;
  /** Exit code known and not 0. */
  failed: boolean;
  shell: Shell;
  /** Known function names (pwsh: lower-cased). */
  functions: Set<string>;
  history: string[];
  /** Words of the first simple command (leading keywords skipped). */
  words: Token[];
  /** Unquoted command name of the first simple command ("" if none). */
  name: string;
};

export type Rule = {
  id: string;
  shell: Shell;
  run: (ctx: Ctx) => Omit<Explanation, "id"> | null;
};
