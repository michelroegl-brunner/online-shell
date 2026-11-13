import { BASH_COMMANDS, NOT_INSTALLED, WINDOWS_IN_BASH } from "./data";
import type { Rule } from "./types";
import { closest, code, replaceToken, rule, unquote } from "./util";

/** Commands that bash could not find or run (exit 127 / 126), cd. */

const quoteArg = (s: string) => (/^["']/.test(s) ? s : `"${s}"`);

export const commandRules: Rule[] = [
  rule({
    id: "cd-glued",
    shell: "BASH",
    test: (ctx) => {
      if (ctx.exitCode !== 127) return null;
      const m = /^cd(\.\.?|\/|~)(\S*)$/.exec(ctx.command);
      return m ? `cd ${m[1]}${m[2]}` : null;
    },
    build: (fix) => ({
      title: "Leerzeichen nach cd fehlt",
      detail: `${code("cd")} ist ein Befehl, das Ziel ein Argument – dazwischen gehört ein Leerzeichen: ${code(fix)}.`,
      fix,
    }),
  }),

  rule({
    id: "cd-failed",
    shell: "BASH",
    test: (ctx) => {
      if (ctx.exitCode !== 1 || ctx.words[0]?.masked !== "cd") return null;
      const args = ctx.words
        .slice(1)
        .filter((w) => !/^-[LPe@]*$/.test(w.masked) && w.masked !== "--");
      if (args.length === 0 || args[0]!.masked === "-") return null;
      if (args.length > 1) {
        const joined = ctx.command.slice(
          args[0]!.start,
          args[args.length - 1]!.end,
        );
        if (/[\\"']/.test(joined)) return null;
        return { many: true, target: joined, fix: `cd ${quoteArg(joined)}` };
      }
      return { many: false, target: unquote(args[0]!.text), fix: undefined };
    },
    build: ({ many, target, fix }) =>
      many
        ? {
            title: "Ordnername mit Leerzeichen",
            detail: `${code("cd")} hat mehrere Argumente bekommen (*too many arguments*). Enthält der Ordnername Leerzeichen, setz ihn in Anführungszeichen.`,
            fix,
          }
        : {
            title: `cd: ${target} nicht gefunden`,
            detail: `Einen Ordner ${code(target)} gibt es von hier aus nicht (oder es ist eine Datei). Groß-/Kleinschreibung zählt! ${code("ls")} zeigt dir, was im aktuellen Ordner liegt, ${code("pwd")}, wo du gerade bist.`,
          },
  }),

  rule({
    id: "cmd-not-installed",
    shell: "BASH",
    test: (ctx) =>
      ctx.exitCode === 127 && Object.hasOwn(NOT_INSTALLED, ctx.name)
        ? ctx.name
        : null,
    build: (name) => ({
      title: `${name} gibt es hier nicht`,
      detail: NOT_INSTALLED[name]!,
    }),
  }),

  rule({
    id: "cmd-windows",
    shell: "BASH",
    test: (ctx) => {
      const w = ctx.words[0];
      if (!w) return null;
      // `type datei.txt`: bash's type looks up commands, not files
      if (
        ctx.name === "type" &&
        ctx.exitCode === 1 &&
        ctx.words.length === 2 &&
        /\.\w+$/.test(ctx.words[1]!.masked)
      ) {
        return {
          name: "type",
          bash: "cat",
          fix: replaceToken(ctx.command, w, "cat"),
        };
      }
      if (ctx.exitCode !== 127) return null;
      const bash = WINDOWS_IN_BASH[ctx.name.toLowerCase()];
      if (!bash) return null;
      // only rewrite plain arguments (no -Parameters)
      const plain = ctx.words.slice(1).every((x) => !x.masked.startsWith("-"));
      return {
        name: ctx.name,
        bash,
        fix: plain ? replaceToken(ctx.command, w, bash) : undefined,
      };
    },
    build: ({ name, bash, fix }) => ({
      title: `${name} ist kein bash-Befehl`,
      detail: `${code(name)} kommt aus ${name.includes("-") ? "PowerShell" : "Windows"}. In bash heißt das ${code(bash)}.`,
      fix,
    }),
  }),

  rule({
    id: "cmd-pwsh-cmdlet",
    shell: "BASH",
    test: (ctx) =>
      ctx.exitCode === 127 &&
      /^(get|set|new|remove|copy|move|rename|write|read|select|where|foreach|sort|measure|clear|start|stop|restart|test|invoke|import|export|convertto|convertfrom|out|format|add|join|split)-[a-z]+$/i.test(
        ctx.name,
      )
        ? ctx.name
        : null,
    build: (name) => ({
      title: "PowerShell-Befehl in bash",
      detail: `${code(name)} ist ein PowerShell-Cmdlet. Dieses Terminal ist eine bash – hier gibt es dafür klassische Befehle wie ${code("ls")}, ${code("cat")}, ${code("cp")}, ${code("grep")}.`,
    }),
  }),

  rule({
    id: "cmd-script-no-dot",
    shell: "BASH",
    test: (ctx) =>
      ctx.exitCode === 127 &&
      /^[\w.-]+\.(sh|bash)$/.test(ctx.name) &&
      ctx.words[0]
        ? {
            name: ctx.name,
            fix: replaceToken(ctx.command, ctx.words[0], `./${ctx.name}`),
          }
        : null,
    build: ({ name, fix }) => ({
      title: "Skripte im aktuellen Ordner: ./",
      detail: `Befehle sucht bash nur in den Ordnern aus ${code("$PATH")}, nicht im aktuellen Ordner. Starte dein Skript mit ${code(`./${name}`)} (braucht ${code("chmod +x")}) oder mit ${code(`bash ${name}`)}.`,
      fix,
    }),
  }),

  rule({
    id: "cmd-permission",
    shell: "BASH",
    test: (ctx) =>
      ctx.exitCode === 126 && /\/[^/]*\.(sh|bash)$/.test(ctx.name)
        ? ctx.name
        : null,
    build: (path, ctx) => ({
      title: "Keine Ausführrechte",
      detail: `Eine Skriptdatei darfst du erst nach ${code(`chmod +x ${path}`)} direkt starten (*Permission denied*). Alternativ ohne Ausführrecht: ${code(`bash ${path}`)}.`,
      fix: `chmod +x ${path} && ${ctx.command}`,
    }),
  }),

  rule({
    id: "cmd-typo",
    shell: "BASH",
    test: (ctx) => {
      const w = ctx.words[0];
      if (ctx.exitCode !== 127 || !w) return null;
      if (!/^[A-Za-z_][\w-]*$/.test(ctx.name)) return null;
      const guess = closest(
        ctx.name,
        [...BASH_COMMANDS, ...ctx.functions],
        false,
        ctx.functions,
      );
      return guess ? { guess, fix: replaceToken(ctx.command, w, guess) } : null;
    },
    build: ({ guess, fix }, ctx) => ({
      title: `Tippfehler? Meintest du ${guess}?`,
      detail: `Einen Befehl ${code(ctx.name)} gibt es nicht${ctx.functions.has(guess) ? ` – aber deine Funktion ${code(guess)}` : ` – aber ${code(guess)}`}.`,
      fix,
    }),
  }),
];
