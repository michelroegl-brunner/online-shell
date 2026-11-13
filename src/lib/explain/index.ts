import { commandRules } from "./commands";
import { functionRules } from "./functions";
import { pwshRules } from "./pwsh";
import { syntaxRules } from "./syntax";
import type { Ctx, ExplainInput, Explanation, Rule } from "./types";
import { functionDefs, maskQuotes, simpleCommands, unquote } from "./util";

export type { Explanation, ExplainInput, Shell } from "./types";
export { functionDefs } from "./util";

/**
 * Explains a likely mistake in one shell command (German, for students).
 *
 * Pure and rule-based: each rule looks at the command text, its exit code
 * and a little context (functions defined earlier, earlier commands) and
 * only fires when the pattern is unambiguous. Order matters: the first
 * matching rule wins, so specific rules come before generic ones (typos).
 * stderr is not available — only the command and its exit code.
 */
export const RULES: Rule[] = [
  ...syntaxRules,
  ...functionRules,
  ...commandRules,
  ...pwshRules,
];

export function explainCommand(input: ExplainInput): Explanation | null {
  const command = input.command.trim();
  if (!command || command.length > 2000) return null;
  const shell = input.shell;
  const { masked, unclosed } = maskQuotes(command, shell);
  const lower = (s: string) => (shell === "PWSH" ? s.toLowerCase() : s);
  const functions = new Set(
    [...(input.knownFunctions ?? []), ...functionDefs(command, shell)].map(
      lower,
    ),
  );
  const words = simpleCommands(command, masked, shell)[0] ?? [];
  const ctx: Ctx = {
    command,
    masked,
    unclosedQuote: unclosed,
    exitCode: input.exitCode,
    failed: input.exitCode !== null && input.exitCode !== 0,
    shell,
    functions,
    history: input.history ?? [],
    words,
    name: words[0] ? unquote(words[0].text) : "",
  };
  for (const r of RULES) {
    if (r.shell !== shell) continue;
    const e = r.run(ctx);
    if (e) return { id: r.id, ...e };
  }
  return null;
}
