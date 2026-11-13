import type { Ctx, Explanation, Rule, Shell, Token } from "./types";

/** Define a rule as `test` (match or null) + `build` (text from the match). */
export function rule<M>(def: {
  id: string;
  shell: Shell;
  test: (ctx: Ctx) => M | null | undefined | false;
  build: (m: M, ctx: Ctx) => Omit<Explanation, "id">;
}): Rule {
  return {
    id: def.id,
    shell: def.shell,
    run: (ctx) => {
      const m = def.test(ctx);
      if (m === null || m === undefined || m === false) return null;
      return def.build(m, ctx);
    },
  };
}

/**
 * Replace the contents of quoted strings (and comments) so that rules can
 * look for syntax without tripping over text inside strings. The result has
 * the same length; quote characters themselves are kept.
 */
export function maskQuotes(
  s: string,
  shell: Shell,
): { masked: string; unclosed: '"' | "'" | null } {
  const out = s.split("");
  let mode: "none" | "single" | "double" | "comment" = "none";
  const esc = shell === "PWSH" ? "`" : "\\";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (mode === "comment") {
      out[i] = " ";
      continue;
    }
    if (mode === "none") {
      if (c === esc) {
        if (i + 1 < s.length) out[i + 1] = "_";
        i++;
      } else if (c === "'") {
        mode = "single";
      } else if (c === '"') {
        mode = "double";
      } else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]!))) {
        mode = "comment";
        out[i] = " ";
      }
      continue;
    }
    if (mode === "single") {
      if (c === "'") {
        // pwsh: '' inside single quotes is an escaped quote
        if (shell === "PWSH" && s[i + 1] === "'") {
          out[i] = "_";
          out[i + 1] = "_";
          i++;
          continue;
        }
        // bash $'…': \' does not end the string
        mode = "none";
        continue;
      }
      if (shell === "BASH" && c === "\\" && isAnsiC(s, i) && s[i + 1]) {
        out[i] = "_";
        out[i + 1] = "_";
        i++;
        continue;
      }
      out[i] = "_";
      continue;
    }
    // double
    if (c === esc && i + 1 < s.length) {
      out[i] = "_";
      out[i + 1] = "_";
      i++;
      continue;
    }
    if (c === '"') {
      if (shell === "PWSH" && s[i + 1] === '"') {
        out[i] = "_";
        out[i + 1] = "_";
        i++;
        continue;
      }
      mode = "none";
      continue;
    }
    out[i] = "_";
  }
  const unclosed = mode === "single" ? "'" : mode === "double" ? '"' : null;
  return { masked: out.join(""), unclosed };
}

/** Is position i inside a bash $'…' string? (scan back to its opening.) */
function isAnsiC(s: string, i: number): boolean {
  const open = s.lastIndexOf("'", i - 1);
  return open > 0 && s[open - 1] === "$";
}

/** Split a masked line into simple-command ranges at ; && || | & newline. */
export function segments(masked: string, shell: Shell): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i]!;
    const two = masked.slice(i, i + 2);
    let len = 0;
    if (two === "&&" || two === "||") len = 2;
    else if (c === ";" || c === "\n" || c === "|") len = 1;
    else if (
      c === "&" &&
      shell === "BASH" &&
      masked[i - 1] !== ">" &&
      masked[i - 1] !== "<" &&
      masked[i + 1] !== ">"
    )
      len = 1;
    if (len) {
      out.push([start, i]);
      start = i + len;
      i += len - 1;
    }
  }
  out.push([start, masked.length]);
  return out;
}

/** Whitespace-separated words of `src` in [from, to), with positions. */
export function tokens(
  src: string,
  masked: string,
  from = 0,
  to = masked.length,
): Token[] {
  const out: Token[] = [];
  const re = /\S+/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) && m.index < to) {
    const end = Math.min(m.index + m[0].length, to);
    out.push({
      text: src.slice(m.index, end),
      masked: masked.slice(m.index, end),
      start: m.index,
      end,
    });
  }
  return out;
}

const LEADING_KEYWORDS = new Set([
  "if",
  "then",
  "elif",
  "else",
  "do",
  "while",
  "until",
  "!",
  "{",
  "}",
  "time",
  "fi",
  "done",
  "esac",
]);

/** Words of every simple command, leading keywords removed. */
export function simpleCommands(
  src: string,
  masked: string,
  shell: Shell,
): Token[][] {
  return segments(masked, shell).map(([a, b]) => {
    const ws = tokens(src, masked, a, b);
    if (shell !== "BASH") return ws;
    for (;;) {
      while (ws.length > 0 && LEADING_KEYWORDS.has(ws[0]!.masked)) ws.shift();
      // `name() {` / `function name {`: the body's first command follows
      const head = ws.findIndex((w) => w.masked === "{");
      const isDef =
        head > 0 &&
        (ws[0]!.masked === "function" ||
          /^[\w.:-]+\s*\(\)$/.test(
            masked.slice(ws[0]!.start, ws[head - 1]!.end).replace(/\s+/g, ""),
          ));
      if (!isDef) return ws;
      ws.splice(0, head + 1);
    }
  });
}

/** Remove shell quoting from a word (good enough for names/paths). */
export function unquote(word: string): string {
  return word.replace(/\\(.)/g, "$1").replace(/["']/g, "");
}

/** Optimal string alignment distance (Levenshtein + transpositions). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) d.push([i]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * The single closest candidate within the allowed distance (1 for short
 * words, 2 otherwise), or null when there is none or it is ambiguous.
 */
export function closest(
  word: string,
  candidates: Iterable<string>,
  caseInsensitive = false,
  preferred?: Set<string>,
): string | null {
  const norm = (x: string) => (caseInsensitive ? x.toLowerCase() : x);
  const w = norm(word);
  const max = w.length <= 4 ? 1 : 2;
  let bestD = Infinity;
  let best: string[] = [];
  const seen = new Set<string>();
  for (const cand of candidates) {
    const c = norm(cand);
    if (seen.has(c)) continue;
    seen.add(c);
    if (c === w) return null; // it IS a known name
    if (Math.abs(c.length - w.length) > max) continue;
    const dist = editDistance(w, c);
    if (dist > max) continue;
    if (dist < bestD) {
      best = [cand];
      bestD = dist;
    } else if (dist === bestD) {
      best.push(cand);
    }
  }
  if (best.length <= 1) return best[0] ?? null;
  // Tie: prefer the student's own names, then swapped letters (sl → ls).
  const sorted = (x: string) => [...norm(x)].sort().join("");
  for (const pick of [
    (c: string) => preferred?.has(c) ?? false,
    (c: string) => sorted(c) === sorted(w),
  ]) {
    const hits = best.filter(pick);
    if (hits.length === 1) return hits[0]!;
  }
  return null;
}

/** Inline code for Markdown (handles backticks in the text). */
export function code(s: string): string {
  const t = s.length > 80 ? `${s.slice(0, 77)}…` : s;
  const fence = t.includes("`") ? "``" : "`";
  const pad = t.startsWith("`") || t.endsWith("`") ? " " : "";
  return `${fence}${pad}${t}${pad}${fence}`;
}

/** Replace the text of a token in the original command. */
export function replaceToken(src: string, t: Token, text: string): string {
  return src.slice(0, t.start) + text + src.slice(t.end);
}

export const IDENT = "[A-Za-z_][A-Za-z0-9_]*";
/** bash function names may contain - and . as well. */
export const FN_NAME = "[A-Za-z_][A-Za-z0-9_.:-]*";

/** Function names defined in a command line. pwsh names are lower-cased. */
export function functionDefs(command: string, shell: Shell): string[] {
  const { masked } = maskQuotes(command, shell);
  const names: string[] = [];
  if (shell === "PWSH") {
    for (const m of masked.matchAll(
      /(?:^|[;{}\s])(?:function|filter)\s+([\w-]+)/gi,
    )) {
      names.push(m[1]!.toLowerCase());
    }
    return names;
  }
  const re = new RegExp(
    `(?:^|[;&|{}(]\\s*|\\s)(?:function\\s+(${FN_NAME})\\s*(?:\\(\\s*\\))?\\s*(?:\\{|$)|(${FN_NAME})\\s*\\(\\s*\\)\\s*(?:\\{|$))`,
    "g",
  );
  for (const m of masked.matchAll(re)) {
    const n = m[1] ?? m[2];
    if (n && n !== "function") names.push(n);
  }
  return names;
}
