import type { Ctx, Explanation, Rule, Token } from "./types";
import {
  closest,
  code,
  editDistance,
  replaceToken,
  rule,
  unquote,
} from "./util";

/**
 * Failed git commands. Only the command and its exit code are known (no
 * stderr), so each rule keys on the subcommand + exit code. Git's codes
 * (checked against git 2.39/2.45):
 *   1   unknown subcommand, nothing to commit, merge/pull conflict, push
 *       rejected, switch with local changes, checkout/restore of unknown
 *       paths, branch -d not merged / not found
 *   128 "fatal": not a repository, unknown path for add, unknown branch
 *       for switch, unknown commit id, no identity, no remote / upstream
 * Where one code has several causes, the text names them (most likely first).
 */

/** Subcommands students use (plus a few more), for typo suggestions. */
const GIT_SUBCOMMANDS = [
  "add",
  "am",
  "bisect",
  "blame",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "clone",
  "commit",
  "config",
  "diff",
  "fetch",
  "grep",
  "help",
  "init",
  "log",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reflog",
  "remote",
  "reset",
  "restore",
  "revert",
  "rm",
  "show",
  "stash",
  "status",
  "switch",
  "tag",
  "version",
];

/** Options of `git` itself that take a value (`git -C dir status`). */
const GIT_VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree"]);

type GitCmd = {
  /** The subcommand token, e.g. `commit`. */
  sub: Token;
  /** Unquoted subcommand. */
  name: string;
  /** Words after the subcommand. */
  args: Token[];
};

function gitCmd(ctx: Ctx): GitCmd | null {
  if (ctx.name !== "git") return null;
  let i = 1;
  while (i < ctx.words.length && ctx.words[i]!.masked.startsWith("-")) {
    i += GIT_VALUE_OPTS.has(ctx.words[i]!.masked) ? 2 : 1;
  }
  const sub = ctx.words[i];
  if (!sub) return null;
  return { sub, name: unquote(sub.text), args: ctx.words.slice(i + 1) };
}

/** A git rule: only for `git <sub>` with the given subcommand(s) and exit code. */
function gitRule<M>(def: {
  id: string;
  /** null = any subcommand */
  subs: string[] | null;
  exit: number[];
  test?: (g: GitCmd, ctx: Ctx) => M | null | undefined | false;
  build: (m: M, g: GitCmd, ctx: Ctx) => Omit<Explanation, "id">;
}): Rule {
  return rule({
    id: def.id,
    shell: "BASH",
    test: (ctx) => {
      if (ctx.exitCode === null || !def.exit.includes(ctx.exitCode))
        return null;
      const g = gitCmd(ctx);
      if (!g || (def.subs && !def.subs.includes(g.name))) return null;
      const m = def.test ? def.test(g, ctx) : (true as M);
      return m === null || m === undefined || m === false ? null : { m, g };
    },
    build: ({ m, g }, ctx) => def.build(m, g, ctx),
  });
}

const plainArgs = (g: GitCmd) =>
  g.args.filter((a) => !a.masked.startsWith("-"));

/** Earlier commands mention this (e.g. `git config … user.email`). */
const inHistory = (ctx: Ctx, re: RegExp) => ctx.history.some((h) => re.test(h));

/**
 * `-m Mein erster Commit`: message words without quotes. Returns the fixed
 * command (message quoted) or null.
 */
function unquotedMessage(g: GitCmd, ctx: Ctx): string | null {
  const m = g.args.findIndex((a) => /^-[a-zA-Z]*m$/.test(a.masked));
  if (m < 0) return null;
  const words: Token[] = [];
  for (const a of g.args.slice(m + 1)) {
    if (a.masked.startsWith("-") || /["']/.test(a.text)) break;
    words.push(a);
  }
  if (words.length < 2) return null;
  const msg = ctx.command.slice(words[0]!.start, words[words.length - 1]!.end);
  return (
    ctx.command.slice(0, words[0]!.start) +
    `"${msg}"` +
    ctx.command.slice(words[words.length - 1]!.end)
  );
}

const NOT_A_REPO = `Bist du im richtigen Ordner? Ein Repository legst du mit ${code("git init")} an (oder holst es mit ${code("git clone")}); ${code("pwd")} zeigt, wo du gerade bist.`;

/**
 * `gut status`, `Git commit`, `gti add`: a near-miss of `git` followed by a
 * git subcommand (exit 127). Runs before the generic typo rule, which can't
 * decide between e.g. git and cut.
 */
export const gitTypoRule: Rule = rule({
  id: "git-typo",
  shell: "BASH",
  test: (ctx) => {
    const [w, sub] = ctx.words;
    if (ctx.exitCode !== 127 || !w || !sub || ctx.name === "git") return null;
    if (!GIT_SUBCOMMANDS.includes(unquote(sub.text).toLowerCase())) return null;
    const n = ctx.name.toLowerCase();
    if (n !== "git" && editDistance(n, "git") > 1) return null;
    return replaceToken(ctx.command, w, "git");
  },
  build: (fix, ctx) => ({
    title: "Tippfehler? Meintest du git?",
    detail: `Einen Befehl ${code(ctx.name)} gibt es nicht – gemeint ist wohl ${code("git")}${ctx.name.toLowerCase() === "git" ? " (Groß-/Kleinschreibung zählt)" : ""}.`,
    fix,
  }),
});

export const gitRules: Rule[] = [
  gitRule({
    id: "git-unknown-subcommand",
    subs: null,
    exit: [1],
    test: (g) => {
      if (GIT_SUBCOMMANDS.includes(g.name) || !/^[a-z][a-z-]*$/i.test(g.name))
        return null;
      return { guess: closest(g.name, GIT_SUBCOMMANDS, true) };
    },
    build: ({ guess }, g, ctx) => ({
      title: guess
        ? `Tippfehler? Meintest du git ${guess}?`
        : `git ${g.name} gibt es nicht`,
      detail: guess
        ? `${code(`git ${g.name}`)} ist kein Git-Befehl – aber ${code(`git ${guess}`)}.`
        : `${code(g.name)} ist kein Git-Befehl. ${code("git help")} zeigt die wichtigsten.`,
      fix: guess ? replaceToken(ctx.command, g.sub, guess) : undefined,
    }),
  }),

  gitRule({
    id: "git-commit-message-quotes",
    subs: ["commit"],
    exit: [1, 128],
    test: (g, ctx) => unquotedMessage(g, ctx),
    build: (fix) => ({
      title: "Commit-Nachricht in Anführungszeichen",
      detail: `Ohne Anführungszeichen ist nur das erste Wort die Nachricht – Git hält den Rest für Dateinamen. Eine Nachricht mit Leerzeichen gehört in Anführungszeichen.`,
      fix,
    }),
  }),

  gitRule({
    id: "git-commit-identity",
    subs: ["commit"],
    exit: [128],
    test: (_g, ctx) =>
      !inHistory(ctx, /\bgit\s+config\b.*\buser\.email\b/) &&
      !inHistory(ctx, /\bgit\s+commit\b/),
    build: () => ({
      title: "Git weiß noch nicht, wer du bist",
      detail: `Jeder Commit speichert Name und E-Mail. Setz sie einmal (*Please tell me who you are*):\n\n${code('git config --global user.name "Vorname Nachname"')}\n${code('git config --global user.email "du@example.com"')}\n\nKommt der Fehler trotzdem: ${NOT_A_REPO}`,
    }),
  }),

  gitRule({
    id: "git-commit-nothing",
    subs: ["commit"],
    exit: [1],
    build: (_m, g) => {
      const withMessage = g.args.some((a) =>
        /^-[a-zA-Z]*[mF]$|^--(message|file)\b/.test(a.masked),
      );
      return {
        title: "Nichts zum Committen",
        detail: `Ein Commit nimmt nur, was du vorher mit ${code("git add")} vorgemerkt hast. ${code("git status")} zeigt, was geändert und was schon vorgemerkt ist.${withMessage ? "" : ` Oder: Du hast den Editor ohne Nachricht verlassen – dann bricht Git ab. Mit ${code('git commit -m "Nachricht"')} geht's ohne Editor.`}`,
      };
    },
  }),

  gitRule({
    id: "git-add-pathspec",
    subs: ["add"],
    exit: [128],
    test: (g, ctx) => {
      const paths = plainArgs(g).map((a) => unquote(a.text));
      if (paths.length === 0 || paths.some((p) => p === "." || p === "-A"))
        return { path: null, fix: undefined };
      const path = paths[0]!;
      // Same name with other capitalisation used earlier (README.md vs Readme.md)?
      const seen = ctx.history
        .flatMap((h) => h.match(/[\w.-]+\.\w+/g) ?? [])
        .find((n) => n !== path && n.toLowerCase() === path.toLowerCase());
      const tok = plainArgs(g)[0]!;
      return {
        path,
        fix: seen ? replaceToken(ctx.command, tok, seen) : undefined,
        seen,
      };
    },
    build: ({ path, fix, seen }) => ({
      title: path ? `${path}: Datei nicht gefunden` : "Kein Git-Repository",
      detail: path
        ? `Git findet ${code(path)} nicht (*pathspec did not match*). Groß-/Kleinschreibung zählt${seen ? ` – meintest du ${code(seen)}?` : `: ${code("README.md")} ist nicht ${code("Readme.md")}.`} ${code("ls")} zeigt die Dateien. Oder: ${NOT_A_REPO}`
        : `Hier ist kein Git-Repository. ${NOT_A_REPO}`,
      fix,
    }),
  }),

  gitRule({
    id: "git-not-a-repo",
    subs: ["status", "diff", "commit", "branch", "remote", "stash"],
    exit: [128],
    // diff with arguments: rather an unknown commit id (below)
    test: (g) => g.name !== "diff" || plainArgs(g).length === 0,
    build: () => ({
      title: "Kein Git-Repository",
      detail: `Dieser Ordner (und keiner darüber) ist ein Git-Repository (*not a git repository*). ${NOT_A_REPO}`,
    }),
  }),

  gitRule({
    id: "git-log-empty",
    subs: ["log", "show"],
    exit: [128],
    test: (g) => plainArgs(g).length === 0,
    build: () => ({
      title: "Noch keine Commits – oder kein Repository",
      detail: `${code("git log")} braucht mindestens einen Commit (*does not have any commits yet*). Mach zuerst einen mit ${code("git add")} und ${code('git commit -m "…"')}. Oder: ${NOT_A_REPO}`,
    }),
  }),

  gitRule({
    id: "git-unknown-revision",
    subs: ["reset", "revert", "show", "log", "cherry-pick", "diff"],
    exit: [128],
    build: () => ({
      title: "Commit oder Branch unbekannt",
      detail: `Git kennt die angegebene ID oder den Namen nicht (*unknown revision*). ${code("git log --oneline")} zeigt die IDs (die 7 Zeichen am Zeilenanfang), ${code("git branch")} die Branches. Spitze Klammern wie ${code("<ID>")} aus Anleitungen gehören nicht dazu.`,
    }),
  }),

  gitRule({
    id: "git-switch-missing",
    subs: ["switch", "checkout"],
    exit: [128, 1],
    test: (g, ctx) => {
      const args = plainArgs(g);
      const create = g.args.some((a) => /^-[cbB]$/.test(a.masked));
      // `git checkout -- datei`: about files, not branches
      if (args.length !== 1 || create || g.args.some((a) => a.masked === "--"))
        return null;
      // switch: 128 = unknown branch, 1 = local changes; checkout: 1 = unknown
      if (g.name === "switch" && ctx.exitCode === 1)
        return { changes: true, branch: "" };
      if (g.name === "checkout" && ctx.exitCode === 128) return null;
      return { changes: false, branch: unquote(args[0]!.text) };
    },
    build: ({ changes, branch }, g) =>
      changes
        ? {
            title: "Ungespeicherte Änderungen im Weg",
            detail: `Beim Wechseln würden Änderungen verloren gehen, die du noch nicht committet hast. Committe sie zuerst (${code("git add")} + ${code("git commit")}) oder verwirf sie mit ${code("git restore <datei>")}.`,
          }
        : {
            title: `Branch ${branch} gibt es nicht`,
            detail: `${code("git branch")} zeigt alle Branches. Einen neuen anlegen und hinwechseln: ${code(`git switch -c ${branch}`)}.`,
            fix: g.name === "switch" ? `git switch -c ${branch}` : undefined,
          },
  }),

  gitRule({
    id: "git-merge-failed",
    subs: ["merge"],
    exit: [1],
    test: (g) =>
      !g.args.some((a) => a.masked === "--abort" || a.masked === "--continue"),
    build: () => ({
      title: "Merge-Konflikt (oder Branch falsch geschrieben)",
      detail: `Meist ein **Konflikt**: Beide Seiten haben dieselbe Stelle geändert. ${code("git status")} zeigt die Dateien. Bearbeite sie, entferne die Marker (${code("<<<<<<<")}, ${code("=======")}, ${code(">>>>>>>")}), dann ${code("git add")} + ${code("git commit")}. Abbrechen: ${code("git merge --abort")}. Steht *not something we can merge* da, gibt es den Branch nicht – ${code("git branch")} zeigt die Namen.`,
    }),
  }),

  gitRule({
    id: "git-push-master",
    subs: ["push"],
    exit: [1],
    test: (g, ctx) =>
      plainArgs(g).some((a) => a.masked === "master") &&
      !inHistory(ctx, /\bmaster\b/),
    build: (_m, _g, ctx) => ({
      title: "Der Branch heißt main",
      detail: `Einen Branch ${code("master")} gibt es hier nicht – der Standard-Branch heißt ${code("main")} (früher oft ${code("master")}). ${code("git branch")} zeigt die Namen.`,
      fix: ctx.command.replace(/\bmaster\b/g, "main"),
    }),
  }),

  gitRule({
    id: "git-push-rejected",
    subs: ["push"],
    exit: [1],
    test: (g) => !g.args.some((a) => /^(-f|--force)/.test(a.masked)),
    build: () => ({
      title: "Push abgelehnt – erst pullen",
      detail: `Auf dem Server sind Commits, die du noch nicht hast (*rejected … fetch first*). Hol sie mit ${code("git pull")} (gibt es einen Konflikt, löst du ihn wie beim Merge) und pushe dann noch einmal. Nicht ${code("--force")} – das würde die Arbeit der anderen überschreiben. (Steht *src refspec … does not match* da, gibt es den angegebenen Branch nicht – ${code("git branch")}.)`,
      fix: "git pull && git push",
    }),
  }),

  gitRule({
    id: "git-push-no-remote",
    subs: ["push", "pull", "fetch"],
    exit: [128],
    build: () => ({
      title: "Kein Remote bzw. kein Upstream",
      detail: `Git weiß nicht, wohin (*no upstream branch* / *no configured push destination*). Beim **ersten** Push eines Branches: ${code("git push -u origin <branch>")}. Hat das Repository noch gar kein Remote (${code("git remote -v")} ist leer): ${code("git remote add origin <adresse>")}. Oder: ${NOT_A_REPO}`,
    }),
  }),

  gitRule({
    id: "git-pull-failed",
    subs: ["pull"],
    exit: [1],
    build: () => ({
      title: "Pull hat nicht geklappt",
      detail: `Häufigste Gründe: ein **Merge-Konflikt** (${code("git status")} zeigt die Dateien – lösen, ${code("git add")}, ${code("git commit")}), oder deine **ungespeicherten Änderungen** würden überschrieben (erst committen). Fehlt die Verbindung zum Remote-Branch (*no tracking information*): ${code("git pull origin main")}.`,
    }),
  }),

  gitRule({
    id: "git-branch-delete",
    subs: ["branch"],
    exit: [1],
    test: (g) =>
      g.args.some((a) => a.masked === "-d" || a.masked === "--delete"),
    build: () => ({
      title: "Branch nicht gelöscht",
      detail: `${code("git branch -d")} löscht nur Branches, die schon **gemergt** sind – sonst gingen Commits verloren. Erst mergen (${code("git merge <branch>")}), dann löschen. Gibt es den Branch nicht, zeigt ${code("git branch")} die richtigen Namen. Den Branch, auf dem du gerade stehst, kannst du nicht löschen.`,
    }),
  }),

  gitRule({
    id: "git-restore-unknown",
    subs: ["restore", "rm"],
    exit: [1, 128],
    test: (g) => plainArgs(g).length > 0,
    build: () => ({
      title: "Datei nicht gefunden",
      detail: `Git kennt diese Datei nicht (*pathspec did not match*). Groß-/Kleinschreibung zählt; ${code("git status")} zeigt die Dateien, die Git beobachtet.`,
    }),
  }),

  gitRule({
    id: "git-clone-failed",
    subs: ["clone"],
    exit: [128],
    build: () => ({
      title: "Klonen fehlgeschlagen",
      detail: `Entweder stimmt die Adresse bzw. der Pfad nicht (*does not exist*), oder den Zielordner gibt es schon und er ist nicht leer (*already exists*). ${code("ls")} zeigt, was im aktuellen Ordner liegt.`,
    }),
  }),
];
