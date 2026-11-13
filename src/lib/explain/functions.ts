import { BASH_COMMANDS } from "./data";
import type { Ctx, Rule } from "./types";
import {
  closest,
  code,
  FN_NAME,
  functionDefs,
  maskQuotes,
  replaceToken,
  rule,
  segments,
  simpleCommands,
  unquote,
} from "./util";

/** Mistakes around bash functions (the topic being taught). */

/** Words after which a `}` on the same line is a real closing brace. */
const CLOSERS = new Set(["}", "fi", "done", "esac", "]]"]);

type Def = {
  name: string;
  /** Head as typed, e.g. "greet()" / "function greet" (trimmed). */
  head: string;
  /** Index of the opening `{`. */
  open: number;
  /** Index of the matching `}` (brace counting), or -1. */
  close: number;
  /** Body between the braces (original text). */
  body: string;
  /** Everything after the closing brace. */
  rest: string;
};

const DEF_RE = new RegExp(
  `^(\\s*(?:function\\s+(${FN_NAME})\\s*(?:\\(\\s*\\))?|(${FN_NAME})\\s*\\(\\s*\\))\\s*)\\{`,
);

/** A function definition at the start of the line, e.g. `greet() { … }`. */
export function parseDef(command: string, masked: string): Def | null {
  const m = DEF_RE.exec(masked);
  if (!m) return null;
  const name = (m[2] ?? m[3])!;
  if (name === "function") return null;
  const open = m[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === "{") depth++;
    else if (masked[i] === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  return {
    name,
    head: command.slice(0, open).trim(),
    open,
    close,
    body:
      close === -1 ? command.slice(open + 1) : command.slice(open + 1, close),
    rest: close === -1 ? "" : command.slice(close + 1),
  };
}

/** Missing `;` (or newline) before the closing `}` of a one-line body? */
function missingSemicolon(def: Def, masked: string): boolean {
  if (def.close === -1) return false;
  const body = masked.slice(def.open + 1, def.close);
  const trimmed = body.trimEnd();
  if (trimmed.trim() === "") return false;
  const last = trimmed[trimmed.length - 1]!;
  if (last === ";" || last === "&" || last === "\n" || last === ")") {
    return false;
  }
  const lastWord = trimmed.split(/\s+/).pop() ?? "";
  return !CLOSERS.has(lastWord);
}

/** `name() { body; }` with normal spacing, keeping the rest of the line. */
function tidyDef(def: Def, masked: string): string {
  let head = def.head;
  if (/^function\s/.test(head) && head.endsWith("{")) head = head.slice(0, -1);
  let body = def.body.trim();
  if (missingSemicolon(def, masked)) body += ";";
  return `${head.trimEnd()} { ${body} }${def.rest}`;
}

/** The most recent definition of `name` in the history (or this line). */
function latestDef(
  name: string,
  ctx: Ctx,
): { command: string; def: Def } | null {
  const lines = [...ctx.history, ctx.command];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const { masked } = maskQuotes(line, "BASH");
    const def = parseDef(line, masked);
    if (def?.name === name && def.close !== -1) return { command: line, def };
  }
  return null;
}

/** Name of the command that ran last on the line (`def; greet` → greet). */
function lastCall(ctx: Ctx): { name: string; text: string } | null {
  const cmds = simpleCommands(ctx.command, ctx.masked, "BASH").filter(
    (c) => c.length > 0,
  );
  const last = cmds[cmds.length - 1];
  if (!last) return null;
  return { name: unquote(last[0]!.text), text: last[0]!.text };
}

/** First non-numeric `return` value in a line, e.g. `return "ok"`. */
function badReturn(
  line: string,
): { value: string; kind: "text" | "range" } | null {
  const { masked } = maskQuotes(line, "BASH");
  for (const words of simpleCommands(line, masked, "BASH")) {
    if (words[0]?.masked !== "return" || !words[1]) continue;
    const v = words[1].text;
    if (/^\d+$/.test(v)) {
      if (Number(v) > 255) return { value: v, kind: "range" };
      continue;
    }
    // $? / $var / $((…)) may well be numeric — can't tell
    if (v.startsWith("$") || v.startsWith('"$')) continue;
    return { value: v, kind: "text" };
  }
  return null;
}

const isBuiltinLike = (name: string, ctx: Ctx) =>
  BASH_COMMANDS.includes(name) || ctx.functions.has(name);

export const functionRules: Rule[] = [
  rule({
    id: "fn-def-params",
    shell: "BASH",
    test: (ctx) => {
      if (!ctx.failed) return null;
      const m = new RegExp(
        `^\\s*(function\\s+)?(${FN_NAME})\\s*\\(([^)]*[^)\\s][^)]*)\\)\\s*\\{`,
      ).exec(ctx.masked);
      if (!m || m[2] === "function") return null;
      const open = m[0].indexOf("(");
      const close = m[0].lastIndexOf(")");
      return {
        name: m[2]!,
        params: ctx.command.slice(open + 1, close),
        fix: `${ctx.command.slice(0, open)}()${ctx.command.slice(close + 1)}`,
      };
    },
    build: ({ name, params, fix }) => ({
      title: "Parameter stehen in bash nicht in den Klammern",
      detail: `Bei bash-Funktionen bleiben die Klammern leer: ${code(`${name}()`)}. Die Werte holst du dir im Körper mit ${code("$1")}, ${code("$2")}, … – statt ${code(params.trim())} also z. B. ${code(`local name="$1"`)}.`,
      fix,
    }),
  }),

  rule({
    id: "fn-empty-body",
    shell: "BASH",
    test: (ctx) => {
      if (!ctx.failed) return null;
      const def = parseDef(ctx.command, ctx.masked);
      return def && def.close !== -1 && def.body.trim() === "" ? def : null;
    },
    build: (def) => ({
      title: "Leerer Funktionskörper",
      detail: `Zwischen ${code("{")} und ${code("}")} muss mindestens ein Befehl stehen. Als Platzhalter geht der Befehl ${code(":")} (tut nichts).`,
      fix: `${def.head} { :; }${def.rest}`,
    }),
  }),

  rule({
    id: "fn-brace-space",
    shell: "BASH",
    test: (ctx) => {
      if (!ctx.failed) return null;
      const def = parseDef(ctx.command, ctx.masked);
      if (!def) return null;
      const glued = /\S/.test(ctx.masked[def.open + 1] ?? " ");
      const nameGlued =
        /^function\s+\S+$/.test(def.head) &&
        /\S/.test(ctx.command[def.open - 1] ?? " ");
      if (!glued && !nameGlued) return null;
      if (ctx.masked[def.open + 1] === "}") return null; // empty body
      return def;
    },
    build: (def, ctx) => ({
      title: "Leerzeichen nach { fehlt",
      detail: `${code("{")} ist für bash ein eigenes Wort und braucht Leerzeichen drumherum. ${code("{echo")} wäre ein Befehl namens „{echo“. Richtig: ${code(`${def.name}() { echo hi; }`)}.`,
      fix: def.close === -1 ? undefined : tidyDef(def, ctx.masked),
    }),
  }),

  rule({
    id: "fn-missing-semicolon",
    shell: "BASH",
    test: (ctx) => {
      const def = parseDef(ctx.command, ctx.masked);
      return def && missingSemicolon(def, ctx.masked) ? def : null;
    },
    build: (def, ctx) => ({
      title: "; vor } fehlt",
      detail: `Steht die Funktion in einer Zeile, braucht der letzte Befehl ein ${code(";")} vor der schließenden ${code("}")}. Sonst hält bash das ${code("}")} für ein Argument (und wartet auf mehr Eingabe).`,
      fix: tidyDef(def, ctx.masked),
    }),
  }),

  rule({
    id: "fn-call-parens",
    shell: "BASH",
    test: (ctx) => {
      if (!ctx.failed) return null;
      for (const [a, b] of segments(ctx.masked, "BASH")) {
        const seg = ctx.masked.slice(a, b);
        const m = new RegExp(`^(\\s*)(${FN_NAME})\\s*\\(([^()]*)\\)\\s*$`).exec(
          seg,
        );
        if (!m || seg.includes("{")) continue;
        const name = m[2]!;
        if (name === "function") continue;
        const inner = ctx.command.slice(
          a + seg.indexOf("(") + 1,
          a + seg.lastIndexOf(")"),
        );
        const innerMasked = seg.slice(
          seg.indexOf("(") + 1,
          seg.lastIndexOf(")"),
        );
        // split on commas outside quotes
        const args: string[] = [];
        let from = 0;
        for (let i = 0; i <= innerMasked.length; i++) {
          if (i === innerMasked.length || innerMasked[i] === ",") {
            const arg = inner.slice(from, i).trim();
            if (arg) args.push(arg);
            from = i + 1;
          }
        }
        const call = [name, ...args].join(" ");
        const fixed =
          ctx.command.slice(0, a) + m[1]! + call + ctx.command.slice(b);
        return { name, call, fix: fixed.trim() };
      }
      return null;
    },
    build: ({ name, call, fix }) => ({
      title: "Funktionen ruft man ohne Klammern auf",
      detail: `In bash rufst du eine Funktion wie einen Befehl auf: Name, dann die Argumente mit Leerzeichen getrennt – ${code(call)}. ${code(`${name}()`)} würde bash als Beginn einer neuen Funktionsdefinition lesen.`,
      fix,
    }),
  }),

  rule({
    id: "fn-return-text",
    shell: "BASH",
    test: (ctx) => {
      const own = badReturn(ctx.command);
      if (own) return own;
      // the call failed with "numeric argument required" (exit 2)?
      if (ctx.exitCode !== 2) return null;
      const call = lastCall(ctx);
      const def = call && latestDef(call.name, ctx);
      return def ? badReturn(def.command) : null;
    },
    build: ({ value, kind }) =>
      kind === "range"
        ? {
            title: "return kennt nur 0–255",
            detail: `${code("return")} setzt nur den Exit-Status (0–255, 0 = Erfolg); ${code(value)} wird zu ${code(String(Number(value) % 256))}. Zahlen oder Text gibst du mit ${code("echo")} aus und holst sie mit ${code("x=$(funktion)")}.`,
          }
        : {
            title: "return gibt keinen Text zurück",
            detail: `${code("return")} setzt nur den Exit-Status (eine Zahl 0–255) – ${code(value)} führt zu *numeric argument required*. Ein Ergebnis gibst du mit ${code("echo")} aus und fängst es mit ${code("ergebnis=$(funktion)")} auf.`,
          },
  }),

  rule({
    id: "fn-return-outside",
    shell: "BASH",
    test: (ctx) =>
      ctx.failed &&
      ctx.words[0]?.masked === "return" &&
      functionDefs(ctx.command, "BASH").length === 0,
    build: () => ({
      title: "return nur in Funktionen",
      detail: `${code("return")} beendet eine Funktion (oder ein mit ${code("source")} geladenes Skript). Direkt in der Shell geht das nicht – dort bräuchtest du ${code("exit")}, das aber das ganze Terminal schließt.`,
    }),
  }),

  rule({
    id: "fn-local-outside",
    shell: "BASH",
    test: (ctx) =>
      ctx.failed &&
      ctx.words[0]?.masked === "local" &&
      ctx.words.length > 1 &&
      functionDefs(ctx.command, "BASH").length === 0
        ? ctx.words
        : null,
    build: (words, ctx) => ({
      title: "local nur in Funktionen",
      detail: `${code("local")} macht eine Variable lokal *innerhalb einer Funktion*. Direkt in der Shell lässt du es einfach weg.`,
      fix: (
        ctx.command.slice(0, words[0]!.start) +
        ctx.command.slice(words[1]!.start)
      ).trim(),
    }),
  }),

  rule({
    id: "fn-body-typo",
    shell: "BASH",
    test: (ctx) => {
      if (ctx.exitCode !== 127) return null;
      const call = lastCall(ctx);
      if (!call || !ctx.functions.has(call.name)) return null;
      const found = latestDef(call.name, ctx);
      if (!found) return null;
      const { masked } = maskQuotes(found.command, "BASH");
      const end = found.def.close;
      for (const words of simpleCommands(found.command, masked, "BASH")) {
        const w = words[0];
        if (!w || w.start <= found.def.open || w.start >= end) continue;
        const n = unquote(w.text);
        if (!/^[A-Za-z_][\w-]*$/.test(n) || isBuiltinLike(n, ctx)) continue;
        const guess = closest(n, [...BASH_COMMANDS, ...ctx.functions]);
        if (guess) {
          return {
            fn: call.name,
            wrong: n,
            guess,
            fix: replaceToken(found.command, w, guess),
          };
        }
      }
      return null;
    },
    build: ({ fn, wrong, guess, fix }) => ({
      title: `Tippfehler in ${fn}?`,
      detail: `Die Funktion ${code(fn)} gibt es, aber in ihr steht ${code(wrong)} – diesen Befehl findet bash nicht. Meintest du ${code(guess)}? Definiere die Funktion korrigiert neu.`,
      fix,
    }),
  }),

  rule({
    id: "fn-lost",
    shell: "BASH",
    test: (ctx) => {
      if (ctx.exitCode !== 127) return null;
      const call = lastCall(ctx);
      if (!call || !ctx.functions.has(call.name)) return null;
      if (functionDefs(ctx.command, "BASH").includes(call.name)) return null;
      // If we can see the body, every command in it must exist — otherwise
      // the 127 may come from inside the function.
      const found = latestDef(call.name, ctx);
      if (found) {
        const { masked } = maskQuotes(found.command, "BASH");
        for (const words of simpleCommands(found.command, masked, "BASH")) {
          const w = words[0];
          if (!w || w.start <= found.def.open || w.start >= found.def.close)
            continue;
          const n = unquote(w.text);
          if (n.includes("=") || n.startsWith("$") || n.includes("/")) continue;
          if (!isBuiltinLike(n, ctx)) return null;
        }
      }
      return call.name;
    },
    build: (name) => ({
      title: `${name} ist in dieser Shell nicht (mehr) definiert`,
      detail: `Funktionen leben nur in der Shell, in der du sie definiert hast. Nach einem neuen Terminal (oder wenn deine Box neu gestartet wurde) sind sie weg. Definiere ${code(name)} neu – oder speichere sie in einer Datei und lade sie mit ${code("source datei.sh")}.`,
    }),
  }),

  rule({
    id: "fn-not-sourced",
    shell: "BASH",
    test: (ctx) => {
      if (ctx.exitCode !== 127) return null;
      const call = lastCall(ctx);
      if (!call || !/^[A-Za-z_][\w-]*$/.test(call.name)) return null;
      if (isBuiltinLike(call.name, ctx)) return null;
      if (closest(call.name, [...BASH_COMMANDS, ...ctx.functions])) return null;
      for (let i = ctx.history.length - 1; i >= 0; i--) {
        const line = ctx.history[i]!.trim();
        const src = /^(?:source|\.)\s+(\S+)/.exec(line);
        if (src) return null; // a file was sourced after the last script run
        const run =
          /^(?:bash|sh)\s+(\S+\.(?:sh|bash))\s*$/.exec(line) ??
          /^(\.{0,2}\/\S+\.(?:sh|bash))\s*$/.exec(line);
        if (run) return { name: call.name, file: unquote(run[1]!), ran: line };
      }
      return null;
    },
    build: ({ name, file, ran }) => ({
      title: "Funktionen aus einem Skript laden: source",
      detail: `Falls ${code(name)} in ${code(file)} definiert ist: ${code(ran)} startet das Skript in einer *eigenen* Shell – seine Funktionen sind danach wieder weg. Mit ${code(`source ${file}`)} lädst du sie in deine aktuelle Shell.`,
      fix: `source ${file}`,
    }),
  }),

  rule({
    id: "source-failed",
    shell: "BASH",
    test: (ctx) =>
      ctx.exitCode === 1 &&
      (ctx.words[0]?.masked === "source" || ctx.words[0]?.masked === ".") &&
      ctx.words.length === 2
        ? unquote(ctx.words[1]!.text)
        : null,
    build: (file) => ({
      title: "source hat nicht geklappt",
      detail: `Lautet die Meldung *No such file or directory*, gibt es ${code(file)} hier nicht – prüf mit ${code("ls")} Name und Ordner (Groß-/Kleinschreibung zählt). Sonst ist ein Befehl *in* der Datei fehlgeschlagen; die Meldung davor nennt die Zeile.`,
    }),
  }),
];
