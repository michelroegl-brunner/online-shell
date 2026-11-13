import type { Rule, Token } from "./types";
import {
  code,
  IDENT,
  rule,
  segments,
  simpleCommands,
  tokens,
  unquote,
} from "./util";

/** bash syntax slips: assignments, test brackets, if/then, quotes. */

/** Quote a value for an assignment if it contains spaces and isn't quoted. */
function assignValue(v: string): string {
  const t = v.trim();
  if (/^(["']).*\1$/.test(t) || !/\s/.test(t)) return t;
  return `"${t}"`;
}

/** Keywords at command position, in order (`if … then … fi` → if, then, fi). */
function keywords(command: string, masked: string): string[] {
  const out: string[] = [];
  const KW = new Set([
    "if",
    "then",
    "elif",
    "else",
    "fi",
    "for",
    "while",
    "until",
    "do",
    "done",
    "case",
    "esac",
    "{",
    "}",
    "!",
    "time",
  ]);
  for (const [a, b] of segments(masked, "BASH")) {
    for (const w of tokens(command, masked, a, b)) {
      if (!KW.has(w.masked)) break;
      out.push(w.masked);
      // `case x in` / `for i in …` : the rest of the segment is not commands
      if (w.masked === "case" || w.masked === "for") break;
    }
  }
  return out;
}

const count = (list: string[], ...words: string[]) =>
  list.filter((w) => words.includes(w)).length;

export const syntaxRules: Rule[] = [
  rule({
    id: "quote-unclosed",
    shell: "BASH",
    test: (ctx) =>
      ctx.failed && ctx.unclosedQuote
        ? {
            quote: ctx.unclosedQuote,
            apostrophe:
              ctx.unclosedQuote === "'" &&
              /[A-Za-zÄÖÜäöü]'[A-Za-zÄÖÜäöü]/.test(ctx.command),
          }
        : null,
    build: ({ quote, apostrophe }) =>
      apostrophe
        ? {
            title: "Apostroph öffnet einen String",
            detail: `Ein ${code("'")} im Text (z. B. in *It's*) beginnt für die Shell einen String, der nie endet – sie wartet dann mit ${code(">")} auf mehr. Setz den ganzen Text in doppelte Anführungszeichen: ${code(`echo "It's me"`)}.`,
          }
        : {
            title: "Anführungszeichen nicht geschlossen",
            detail: `Ein ${code(quote)} wurde geöffnet, aber nicht geschlossen. Die Shell wartet dann mit ${code(">")} auf den Rest (abbrechen mit Strg+C). Zähl die ${code(quote)} in deinem Befehl nach.`,
          },
  }),

  rule({
    id: "assign-spaces",
    shell: "BASH",
    test: (ctx) => {
      if (ctx.exitCode !== 127) return null;
      const m =
        new RegExp(`^\\s*(${IDENT})\\s+=(?!=)\\s*(.*)$`).exec(ctx.masked) ??
        new RegExp(`^\\s*(${IDENT})=\\s+(\\S.*)$`).exec(ctx.masked);
      if (!m) return null;
      if (/[;&|]/.test(m[2]!)) return null;
      const value = ctx.command.slice(ctx.command.length - m[2]!.length);
      return { name: m[1]!, value };
    },
    build: ({ name, value }) => ({
      title: "Keine Leerzeichen um das =",
      detail: `Bei einer Zuweisung darf um das ${code("=")} kein Leerzeichen stehen. Mit Leerzeichen hält bash ${code(name)} (oder den Wert) für einen Befehl.`,
      fix: `${name}=${assignValue(value)}`,
    }),
  }),

  rule({
    id: "assign-dollar",
    shell: "BASH",
    test: (ctx) => {
      if (ctx.exitCode !== 127) return null;
      const m = new RegExp(`^\\s*\\$\\{?(${IDENT})\\}?=(.*)$`).exec(ctx.masked);
      if (!m || /[;&|]/.test(m[2]!)) return null;
      return {
        name: m[1]!,
        value: ctx.command.slice(ctx.command.length - m[2]!.length),
      };
    },
    build: ({ name, value }) => ({
      title: "Beim Zuweisen kein $",
      detail: `Das ${code("$")} brauchst du nur zum *Lesen* einer Variable (${code(`echo $${name}`)}). Beim Zuweisen schreibst du nur den Namen.`,
      fix: `${name}=${assignValue(value)}`,
    }),
  }),

  rule({
    id: "test-if-glued",
    shell: "BASH",
    test: (ctx) => {
      const m = /(^|[;&|]\s*|\s)(if|elif|while|until)\[/.exec(ctx.masked);
      if (!m) return null;
      const at = m.index + m[1]!.length + m[2]!.length;
      return {
        kw: m[2]!,
        fix: `${ctx.command.slice(0, at)} ${ctx.command.slice(at)}`,
      };
    },
    build: ({ kw, fix }) => ({
      title: `Leerzeichen nach ${kw} fehlt`,
      detail: `${code("[")} ist ein eigener Befehl und braucht Leerzeichen drumherum: ${code(`${kw} [ … ]`)}. ${code(`${kw}[`)} ist für bash ein unbekanntes Wort.`,
      fix,
    }),
  }),

  rule({
    id: "test-bracket-space",
    shell: "BASH",
    test: (ctx) => {
      let fix = ctx.command;
      let found = false;
      // right to left so earlier positions stay valid
      const cmds = simpleCommands(ctx.command, ctx.masked, "BASH").reverse();
      for (const words of cmds) {
        const first = words[0];
        const last = words[words.length - 1];
        if (!first || !last) continue;
        const open = /^\[\[?/.exec(first.masked)?.[0];
        if (!open) continue;
        const close = open === "[[" ? "]]" : "]";
        const edits: { t: Token; text: string }[] = [];
        if (
          words.length > 1 &&
          /\S\]+$/.test(last.masked) &&
          last.masked !== close &&
          /[^\]]\]+$/.test(last.masked)
        ) {
          const n = /\]+$/.exec(last.masked)![0].length;
          edits.push({
            t: last,
            text: `${last.text.slice(0, -n)} ${last.text.slice(-n)}`,
          });
        }
        if (
          first.masked !== open &&
          !/[[\]]/.test(first.masked[open.length]!)
        ) {
          if (words.length === 1 && first.masked.endsWith("]")) continue; // [abc] glob
          edits.push({
            t: first,
            text: `${open} ${first.text.slice(open.length)}`,
          });
        }
        for (const e of edits.sort((a, b) => b.t.start - a.t.start)) {
          fix = fix.slice(0, e.t.start) + e.text + fix.slice(e.t.end);
          found = true;
        }
      }
      return found ? fix : null;
    },
    build: (fix) => ({
      title: "Leerzeichen in [ … ] fehlen",
      detail: `${code("[")} ist ein Befehl, ${code("]")} sein letztes Argument – beide brauchen Leerzeichen: ${code('[ "$x" -eq 1 ]')}. ${code("[$x")} oder ${code("1]")} versteht bash nicht.`,
      fix,
    }),
  }),

  rule({
    id: "test-redirect",
    shell: "BASH",
    test: (ctx) => {
      let fix = ctx.command;
      let op = "";
      let target = "";
      const cmds = simpleCommands(ctx.command, ctx.masked, "BASH").reverse();
      for (const words of cmds) {
        if (words[0]?.masked !== "[") continue;
        const end = words.findIndex((w) => w.masked === "]");
        const inner = words.slice(1, end === -1 ? words.length : end);
        for (let i = inner.length - 1; i >= 0; i--) {
          const w = inner[i]!;
          const m = /^(>=?|<=?)(.*)$/.exec(w.masked);
          if (!m) continue;
          const repl = { ">": "-gt", ">=": "-ge", "<": "-lt", "<=": "-le" }[
            m[1]!
          ]!;
          const rest = w.text.slice(m[1]!.length);
          fix =
            fix.slice(0, w.start) +
            repl +
            (rest ? ` ${rest}` : "") +
            fix.slice(w.end);
          op = m[1]!;
          target = unquote(rest || (inner[i + 1]?.text ?? "")) || "5";
        }
      }
      return op ? { op, fix, target } : null;
    },
    build: ({ op, fix, target }) => ({
      title: `${op[0]} ist in [ ] eine Umleitung`,
      detail: `In ${code("[ … ]")} ist ${code(op[0]!)} kein Vergleich, sondern eine Umleitung: ${op.startsWith(">") ? `Es entsteht eine (leere) Datei namens *${target}*` : `bash versucht, aus einer Datei *${target}* zu lesen`}. Zahlen vergleichst du mit ${code("-gt")}, ${code("-lt")}, ${code("-ge")}, ${code("-le")}, ${code("-eq")}, ${code("-ne")}.`,
      fix,
    }),
  }),

  rule({
    id: "then-semicolon",
    shell: "BASH",
    test: (ctx) => {
      const m =
        /(\]\]?|\)\))(\s+)(then|do)\b/.exec(ctx.masked) ??
        new RegExp(
          `\\bfor\\s+${IDENT}\\s+in\\s+[^;\\n]*?[^;\\s](\\s+)(do)\\b`,
        ).exec(ctx.masked);
      if (!m) return null;
      const kw = m[m.length - 1]!;
      const at = m.index + m[0].length - kw.length - m[m.length - 2]!.length;
      return {
        kw,
        fix: `${ctx.command.slice(0, at)};${ctx.command.slice(at)}`,
      };
    },
    build: ({ kw, fix }) => ({
      title: `; vor ${kw} fehlt`,
      detail: `Steht ${code(kw)} in derselben Zeile wie die Bedingung, braucht es davor ein ${code(";")}: ${code(kw === "then" ? 'if [ "$x" -eq 1 ]; then …; fi' : "for i in 1 2 3; do …; done")}.`,
      fix,
    }),
  }),

  rule({
    id: "block-unclosed",
    shell: "BASH",
    test: (ctx) => {
      if (!ctx.failed || ctx.unclosedQuote) return null;
      const kw = keywords(ctx.command, ctx.masked);
      const ifs = count(kw, "if");
      const loops = count(kw, "for", "while", "until");
      const cases = count(kw, "case");
      const need =
        ifs > count(kw, "fi")
          ? "fi"
          : loops > count(kw, "done")
            ? "done"
            : cases > count(kw, "esac")
              ? "esac"
              : null;
      if (!need) return null;
      const opener =
        need === "fi" ? "if" : need === "done" ? "for/while" : "case";
      const canFix =
        (need === "fi" &&
          ifs - count(kw, "fi") === 1 &&
          count(kw, "then") === count(kw, "if", "elif")) ||
        (need === "done" &&
          loops - count(kw, "done") === 1 &&
          count(kw, "do") === loops);
      return {
        need,
        opener,
        fix: canFix
          ? `${ctx.command.replace(/[;\s]*$/, "")}; ${need}`
          : undefined,
      };
    },
    build: ({ need, opener, fix }) => ({
      title: `${need} fehlt`,
      detail: `Ein ${code(opener)}-Block endet erst mit ${code(need)}. Fehlt es, wartet die Shell mit ${code(">")} auf den Rest der Eingabe.`,
      fix,
    }),
  }),
];
