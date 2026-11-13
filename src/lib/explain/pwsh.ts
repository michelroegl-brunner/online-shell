import { PWSH_COMMANDS } from "./data";
import type { Ctx, Rule } from "./types";
import {
  closest,
  code,
  IDENT,
  maskQuotes,
  replaceToken,
  rule,
  segments,
} from "./util";

/** PowerShell beginner mistakes, mostly bash habits. */

/** Parameter count of the latest visible definition of `name`, or null. */
function paramCount(name: string, ctx: Ctx): number | null {
  const lines = [...ctx.history, ctx.command];
  const re = new RegExp(
    `(?:^|[;{}\\s])(?:function|filter)\\s+${name.replace(/[-.]/g, "\\$&")}\\s*(\\(([^)]*)\\))?\\s*\\{([^]*)$`,
    "i",
  );
  for (let i = lines.length - 1; i >= 0; i--) {
    const { masked } = maskQuotes(lines[i]!, "PWSH");
    const m = re.exec(masked);
    if (!m) continue;
    const list = m[2] ?? /\bparam\s*\(([^)]*)\)/i.exec(m[3] ?? "")?.[1] ?? "";
    return list.trim() === "" ? 0 : list.split(",").length;
  }
  return null;
}

/** Split `a, b ,c` (masked for commas) into trimmed original pieces. */
function splitArgs(src: string, masked: string): string[] {
  const out: string[] = [];
  let from = 0;
  let depth = 0;
  for (let i = 0; i <= masked.length; i++) {
    const c = masked[i];
    if (c === "(" || c === "@" || c === "[") depth += c === "@" ? 0 : 1;
    else if (c === ")" || c === "]") depth--;
    if (i === masked.length || (c === "," && depth === 0)) {
      const a = src.slice(from, i).trim();
      if (a) out.push(a);
      from = i + 1;
    }
  }
  return out;
}

type OpFix = { at: number; len: number; repl: string; op: string };

/** Comparison mistakes: == / != anywhere, > < = inside if/while (…). */
function comparisonFixes(masked: string): OpFix[] {
  const fixes: OpFix[] = [];
  const inCond: [number, number][] = [];
  for (const m of masked.matchAll(/\b(?:if|elseif|while)\s*\(/gi)) {
    let depth = 0;
    const start = m.index + m[0].length - 1;
    for (let i = start; i < masked.length; i++) {
      if (masked[i] === "(") depth++;
      else if (masked[i] === ")" && --depth === 0) {
        inCond.push([start + 1, i]);
        break;
      }
    }
  }
  const cond = (i: number) => inCond.some(([a, b]) => i >= a && i < b);
  /** Directly inside the condition, not in nested (…) like `(($x = f))`. */
  const top = (i: number) =>
    inCond.some(([a, b]) => {
      if (i < a || i >= b) return false;
      let depth = 0;
      for (let j = a; j < i; j++) {
        if (masked[j] === "(") depth++;
        else if (masked[j] === ")") depth--;
      }
      return depth === 0;
    });
  for (let i = 0; i < masked.length; i++) {
    const two = masked.slice(i, i + 2);
    const c = masked[i]!;
    const prev = masked[i - 1] ?? " ";
    if (two === "==" || two === "!=") {
      fixes.push({
        at: i,
        len: 2,
        repl: two === "==" ? "-eq" : "-ne",
        op: two,
      });
      i++;
    } else if (!cond(i)) {
      continue;
    } else if (two === ">=" || two === "<=") {
      fixes.push({
        at: i,
        len: 2,
        repl: two === ">=" ? "-ge" : "-le",
        op: two,
      });
      i++;
    } else if ((c === ">" || c === "<") && !/[0-9*]/.test(prev)) {
      fixes.push({ at: i, len: 1, repl: c === ">" ? "-gt" : "-lt", op: c });
    } else if (
      c === "=" &&
      top(i) &&
      !/[-+*/%=!<>]/.test(prev) &&
      masked[i + 1] !== "="
    ) {
      fixes.push({ at: i, len: 1, repl: "-eq", op: "=" });
    }
  }
  return fixes;
}

function applyFixes(src: string, masked: string, fixes: OpFix[]): string {
  let out = src;
  for (const f of [...fixes].sort((a, b) => b.at - a.at)) {
    let a = f.at;
    let b = f.at + f.len;
    while (a > 0 && /\s/.test(masked[a - 1]!)) a--;
    while (b < masked.length && /\s/.test(masked[b]!)) b++;
    out = `${out.slice(0, a)} ${f.repl} ${out.slice(b)}`;
  }
  return out;
}

const psValue = (v: string) => {
  const t = v.trim();
  if (/^-?\d+(\.\d+)?$/.test(t) || /^(["']).*\1$/.test(t) || t.startsWith("$"))
    return t;
  return `"${t}"`;
};

export const pwshRules: Rule[] = [
  rule({
    id: "ps-bash-function-def",
    shell: "PWSH",
    test: (ctx) => {
      if (!ctx.failed) return null;
      const m = /^\s*([A-Za-z_][\w-]*)\s*\(\s*\)\s*\{/.exec(ctx.masked);
      if (!m || /^function$/i.test(m[1]!)) return null;
      return {
        name: m[1]!,
        fix: `function ${m[1]} {${ctx.command.slice(m[0].length)}`,
      };
    },
    build: ({ name, fix }) => ({
      title: "So definiert man in PowerShell keine Funktion",
      detail: `${code(`${name}() { … }`)} ist bash-Schreibweise. In PowerShell beginnt eine Funktion mit dem Wort ${code("function")}: ${code(`function ${name} { … }`)}. Parameter holst du mit ${code("param($name)")} oder ${code("$args")}.`,
      fix,
    }),
  }),

  rule({
    id: "ps-call-parens",
    shell: "PWSH",
    test: (ctx) => {
      for (const [a, b] of segments(ctx.masked, "PWSH")) {
        const seg = ctx.masked.slice(a, b);
        const src = ctx.command.slice(a, b);
        const glued = /^(\s*)([A-Za-z_][\w-]*)\s*\((.*)\)\s*$/.exec(seg);
        const spaced = /^(\s*)([A-Za-z_][\w-]*)\s+([^()]*,[^()]*)$/.exec(seg);
        const m = glued ?? spaced;
        if (
          !m ||
          /^(function|filter|if|elseif|while|foreach|switch|for|param)$/i.test(
            m[2]!,
          )
        )
          continue;
        const name = m[2]!;
        if (!ctx.functions.has(name.toLowerCase())) continue;
        const argStart =
          m[1]!.length + seg.slice(m[1]!.length).indexOf(m[3]!, name.length);
        const inner = src.slice(argStart, argStart + m[3]!.length);
        const innerMasked = m[3]!;
        if (/(^|\s)-[A-Za-z]/.test(innerMasked)) continue; // named parameters
        const args = splitArgs(inner, innerMasked);
        const hasComma = innerMasked.includes(",");
        if (glued && args.length === 0) {
          if (!ctx.failed) continue;
        } else if (!hasComma || (paramCount(name, ctx) ?? 0) < 2) {
          continue;
        }
        const call = [name, ...args].join(" ");
        const fix = (
          ctx.command.slice(0, a) +
          m[1]! +
          call +
          ctx.command.slice(b)
        ).trim();
        return { name, call, fix, comma: hasComma };
      }
      return null;
    },
    build: ({ name, call, fix, comma }) => ({
      title: comma
        ? "Argumente mit Leerzeichen trennen, nicht mit Komma"
        : "Funktionen ruft man ohne Klammern auf",
      detail: comma
        ? `In PowerShell ist ${code("1,2")} *ein* Argument: ein Array. Deine Funktion ${code(name)} bekommt so alles im ersten Parameter. Rufe sie wie einen Befehl auf: ${code(call)}.`
        : `PowerShell-Funktionen rufst du wie Befehle auf, ohne Klammern: ${code(call)}.`,
      fix,
    }),
  }),

  rule({
    id: "ps-compare-op",
    shell: "PWSH",
    test: (ctx) => {
      const fixes = comparisonFixes(ctx.masked);
      if (fixes.length === 0) return null;
      return {
        op: fixes[0]!.op,
        fix: applyFixes(ctx.command, ctx.masked, fixes),
      };
    },
    build: ({ op, fix }) => {
      const why =
        op === "="
          ? `In der Bedingung *weist* ${code("=")} einen Wert *zu* – die Bedingung ist dann fast immer wahr.`
          : op === ">" || op === ">="
            ? `${code(">")} leitet in PowerShell in eine Datei um (es entsteht z. B. eine Datei *5*) und vergleicht nicht.`
            : op === "<" || op === "<="
              ? `${code("<")} ist in PowerShell reserviert und vergleicht nicht.`
              : `${code(op)} gibt es in PowerShell nicht.`;
      return {
        title: "Vergleiche in PowerShell: -eq, -gt, …",
        detail: `${why} PowerShell vergleicht mit ${code("-eq")}, ${code("-ne")}, ${code("-gt")}, ${code("-lt")}, ${code("-ge")}, ${code("-le")}: ${code("if ($x -eq 5) { … }")}.`,
        fix,
      };
    },
  }),

  rule({
    id: "ps-bash-syntax",
    shell: "PWSH",
    test: (ctx) => {
      if (!ctx.failed) return null;
      const m = ctx.masked;
      const simple =
        /^\s*if\s+\[\[?\s+(.+?)\s+\]\]?\s*;\s*then\s+(.+?)\s*;?\s*fi\s*$/.exec(
          m,
        );
      if (simple) {
        const condSrc = ctx.command.slice(
          m.indexOf(simple[1]!),
          m.indexOf(simple[1]!) + simple[1]!.length,
        );
        const bodyStart = m.lastIndexOf(simple[2]!);
        const body = ctx.command.slice(
          bodyStart,
          bodyStart + simple[2]!.length,
        );
        const cond = condSrc
          .replace(/\s(==?)\s/g, " -eq ")
          .replace(/\s!=\s/g, " -ne ");
        const unary = /(^|\s)-[a-z]\s/.test(
          simple[1]!.replace(/-(eq|ne|gt|lt|ge|le)\b/g, ""),
        );
        return {
          what: "if",
          fix: unary ? undefined : `if (${cond}) { ${body} }`,
        };
      }
      if (
        /^\s*if\s+\[/.test(m) ||
        /;\s*then\b/.test(m) ||
        /;\s*fi\s*$/.test(m)
      ) {
        return { what: "if", fix: undefined };
      }
      if (
        new RegExp(`^\\s*for\\s+${IDENT}\\s+in\\b`).test(m) ||
        /;\s*do\s+(?!\{)/.test(m)
      ) {
        return { what: "for", fix: undefined };
      }
      return null;
    },
    build: ({ what, fix }) => ({
      title: "bash-Syntax in PowerShell",
      detail:
        what === "if"
          ? `${code("if [ … ]; then … fi")} ist bash. In PowerShell steht die Bedingung in runden, der Block in geschweiften Klammern: ${code("if ($x -eq 1) { … }")}.`
          : `${code("for … in …; do … done")} ist bash. In PowerShell: ${code("foreach ($i in 1..3) { … }")}.`,
      fix,
    }),
  }),

  rule({
    id: "ps-export",
    shell: "PWSH",
    test: (ctx) => {
      if (!ctx.failed) return null;
      const m = new RegExp(`^\\s*export\\s+(${IDENT})=(\\S*)\\s*$`).exec(
        ctx.masked,
      );
      if (!m) return null;
      const value = ctx.command.slice(ctx.command.length - m[2]!.length).trim();
      return { name: m[1]!, value };
    },
    build: ({ name, value }) => ({
      title: "export gibt es in PowerShell nicht",
      detail: `Umgebungsvariablen setzt du in PowerShell über ${code("$env:")}.`,
      fix: `$env:${name} = ${psValue(value || '""')}`,
    }),
  }),

  rule({
    id: "ps-bash-assign",
    shell: "PWSH",
    test: (ctx) => {
      if (!ctx.failed) return null;
      const m = new RegExp(`^\\s*(${IDENT})=(\\S*)\\s*$`).exec(ctx.masked);
      if (!m) return null;
      const value = ctx.command.slice(ctx.command.length - m[2]!.length).trim();
      return { name: m[1]!, value };
    },
    build: ({ name, value }) => ({
      title: "Variablen beginnen mit $",
      detail: `In PowerShell schreibst du Variablen immer mit ${code("$")} – auch beim Zuweisen. Leerzeichen um ${code("=")} sind hier erlaubt.`,
      fix: `$${name} = ${psValue(value || '""')}`,
    }),
  }),

  rule({
    id: "ps-source",
    shell: "PWSH",
    test: (ctx) =>
      ctx.failed && ctx.name.toLowerCase() === "source" && ctx.words[1]
        ? ctx.words[1].text
        : null,
    build: (file) =>
      /\.ps1$/i.test(file)
        ? {
            title: "Skript laden: . statt source",
            detail: `PowerShell kennt ${code("source")} nicht. Funktionen aus einem Skript lädst du mit einem Punkt davor („dot-sourcing“).`,
            fix: `. ${/^[.~/]/.test(file) ? file : `./${file}`}`,
          }
        : {
            title: "source gibt es in PowerShell nicht",
            detail:
              `Zum Laden eines PowerShell-Skripts schreibst du ${code(". ./datei.ps1")}. ${file.endsWith(".sh") ? `${code(file)} ist aber ein bash-Skript – das läuft nicht in PowerShell.` : ""}`.trim(),
          },
  }),

  rule({
    id: "ps-script-no-dot",
    shell: "PWSH",
    test: (ctx) =>
      ctx.failed && /^[\w.-]+\.ps1$/i.test(ctx.name) && ctx.words[0]
        ? replaceToken(ctx.command, ctx.words[0], `./${ctx.name}`)
        : null,
    build: (fix, ctx) => ({
      title: "Skripte im aktuellen Ordner: ./",
      detail: `PowerShell startet Skripte aus dem aktuellen Ordner nur mit Pfad davor: ${code(`./${ctx.name}`)}.`,
      fix,
    }),
  }),

  rule({
    id: "ps-cmdlet-typo",
    shell: "PWSH",
    test: (ctx) => {
      const w = ctx.words[0];
      if (!ctx.failed || !w || !/^[A-Za-z]+-[A-Za-z]+$/.test(ctx.name))
        return null;
      const [verb, noun] = ctx.name.toLowerCase().split("-");
      const guess = closest(
        ctx.name,
        [...PWSH_COMMANDS, ...ctx.functions],
        true,
      );
      if (!guess) return null;
      const [gv, gn] = guess.toLowerCase().split("-");
      // only a slip in either the verb or the noun, not both
      if (gv !== verb && gn !== noun) return null;
      return { guess, fix: replaceToken(ctx.command, w, guess) };
    },
    build: ({ guess, fix }, ctx) => ({
      title: `Tippfehler? Meintest du ${guess}?`,
      detail: `Ein Cmdlet ${code(ctx.name)} gibt es nicht – aber ${code(guess)}. ${code("Get-Command *teil*")} hilft beim Suchen.`,
      fix,
    }),
  }),
];
