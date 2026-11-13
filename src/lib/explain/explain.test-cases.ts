import type { ExplainInput } from "./types";

/**
 * Cases for explainCommand(): `expectId` is the rule that must fire, or null
 * when nothing may be shown. `expectFix` (optional) must equal the fix.
 * Exit codes are what real bash 5.2 / pwsh 7 report for the command.
 */
export type ExplainCase = {
  input: ExplainInput;
  expectId: string | null;
  expectFix?: string;
};

const b = (
  command: string,
  exitCode: number | null,
  extra: Partial<ExplainInput> = {},
): ExplainInput => ({ command, exitCode, shell: "BASH", ...extra });
const p = (
  command: string,
  exitCode: number | null,
  extra: Partial<ExplainInput> = {},
): ExplainInput => ({ command, exitCode, shell: "PWSH", ...extra });

export const explainCases: ExplainCase[] = [
  // ── git (exit codes from real git) ─────────────────────────────────────
  {
    input: b("gut status", 127),
    expectId: "git-typo",
    expectFix: "git status",
  },
  {
    input: b("Git commit -m x", 127),
    expectId: "git-typo",
    expectFix: "git commit -m x",
  },
  { input: b("gti add .", 127), expectId: "git-typo", expectFix: "git add ." },
  { input: b("gut", 127), expectId: null },
  {
    input: b('git comit -m "x"', 1),
    expectId: "git-unknown-subcommand",
    expectFix: 'git commit -m "x"',
  },
  {
    input: b("git stauts", 1),
    expectId: "git-unknown-subcommand",
    expectFix: "git status",
  },
  {
    input: b("git -C ich pussh", 1),
    expectId: "git-unknown-subcommand",
    expectFix: "git -C ich push",
  },
  { input: b("git frobnicate", 1), expectId: "git-unknown-subcommand" },
  {
    input: b("git commit -m Mein erster Commit", 1),
    expectId: "git-commit-message-quotes",
    expectFix: 'git commit -m "Mein erster Commit"',
  },
  {
    input: b("git commit -am README ergänzt", 1),
    expectId: "git-commit-message-quotes",
    expectFix: 'git commit -am "README ergänzt"',
  },
  { input: b('git commit -m "x"', 128), expectId: "git-commit-identity" },
  {
    input: b('git commit -m "x"', 128, {
      history: ['git config --global user.email "a@b.c"'],
    }),
    expectId: "git-not-a-repo",
  },
  {
    input: b('git commit -m "README angelegt"', 1),
    expectId: "git-commit-nothing",
  },
  { input: b("git commit", 1), expectId: "git-commit-nothing" },
  { input: b("git status", 128), expectId: "git-not-a-repo" },
  { input: b("git diff", 128), expectId: "git-not-a-repo" },
  { input: b("git log --oneline", 128), expectId: "git-log-empty" },
  { input: b("git add Readme.md", 128), expectId: "git-add-pathspec" },
  {
    input: b("git add Readme.md", 128, {
      history: ['echo "# Mein Projekt" > README.md'],
    }),
    expectId: "git-add-pathspec",
    expectFix: "git add README.md",
  },
  { input: b("git add .", 128), expectId: "git-add-pathspec" },
  { input: b("git revert --no-edit <ID>", 1), expectId: null },
  {
    input: b("git revert --no-edit abc123", 128),
    expectId: "git-unknown-revision",
  },
  {
    input: b("git reset --hard HEAD@{5}", 128),
    expectId: "git-unknown-revision",
  },
  {
    input: b("git switch feature/salat", 128),
    expectId: "git-switch-missing",
    expectFix: "git switch -c feature/salat",
  },
  { input: b("git switch main", 1), expectId: "git-switch-missing" },
  { input: b("git checkout nope", 1), expectId: "git-switch-missing" },
  { input: b("git checkout -- datei.txt", 1), expectId: null },
  { input: b("git switch -c neu", 128), expectId: null },
  { input: b("git merge feature/preis", 1), expectId: "git-merge-failed" },
  { input: b("git merge --abort", 128), expectId: null },
  {
    input: b("git push origin master", 1),
    expectId: "git-push-master",
    expectFix: "git push origin main",
  },
  {
    input: b("git push", 1),
    expectId: "git-push-rejected",
    expectFix: "git pull && git push",
  },
  { input: b("git push --force", 1), expectId: null },
  { input: b("git push", 128), expectId: "git-push-no-remote" },
  { input: b("git pull", 1), expectId: "git-pull-failed" },
  { input: b("git branch -d feature/salat", 1), expectId: "git-branch-delete" },
  { input: b("git restore anleitung.txt", 1), expectId: "git-restore-unknown" },
  {
    input: b("git clone server/projekt.git ich", 128),
    expectId: "git-clone-failed",
  },
  { input: b("git status", 0), expectId: null },
  { input: b('git commit -m "ok"', 0), expectId: null },
  { input: b("git log --oneline --graph --all", 0), expectId: null },

  // ── functions ──────────────────────────────────────────────────────────
  {
    input: b("greet(){echo hi;}", 2),
    expectId: "fn-brace-space",
    expectFix: "greet() { echo hi; }",
  },
  {
    input: b("function greet{ echo hi; }", 2),
    expectId: "fn-brace-space",
    expectFix: "function greet { echo hi; }",
  },
  {
    input: b("greet() {echo hi }", 130),
    expectId: "fn-brace-space",
    expectFix: "greet() { echo hi; }",
  },
  {
    input: b("greet() { echo hi }", 130),
    expectId: "fn-missing-semicolon",
    expectFix: "greet() { echo hi; }",
  },
  {
    input: b('greet() { echo "Hallo $1" }', 0),
    expectId: "fn-missing-semicolon",
    expectFix: 'greet() { echo "Hallo $1"; }',
  },
  {
    input: b("f() { echo ${HOME} }", 2),
    expectId: "fn-missing-semicolon",
  },
  { input: b("greet() {}", 2), expectId: "fn-empty-body" },
  {
    input: b("greet()", 130, { knownFunctions: ["greet"] }),
    expectId: "fn-call-parens",
    expectFix: "greet",
  },
  {
    input: b("greet(Max)", 2, { knownFunctions: ["greet"] }),
    expectId: "fn-call-parens",
    expectFix: "greet Max",
  },
  {
    input: b('greet("Max", 3)', 2),
    expectId: "fn-call-parens",
    expectFix: 'greet "Max" 3',
  },
  {
    input: b("greet() { echo hi; }; greet()", 2),
    expectId: "fn-call-parens",
    expectFix: "greet() { echo hi; }; greet",
  },
  {
    input: b("greet(name) { echo $name; }", 2),
    expectId: "fn-def-params",
    expectFix: "greet() { echo $name; }",
  },
  {
    input: b("function greet(name) { echo $1; }", 2),
    expectId: "fn-def-params",
  },
  { input: b('ok() { return "fertig"; }', 0), expectId: "fn-return-text" },
  {
    input: b("ok", 2, { history: ['ok() { return "fertig"; }'] }),
    expectId: "fn-return-text",
  },
  { input: b("big() { return 300; }", 0), expectId: "fn-return-text" },
  { input: b("return 1", 1), expectId: "fn-return-outside" },
  { input: b("local x=1", 1), expectId: "fn-local-outside", expectFix: "x=1" },
  {
    input: b("greet", 127, {
      knownFunctions: ["greet"],
      history: ["greet() { ech hi; }"],
    }),
    expectId: "fn-body-typo",
    expectFix: "greet() { echo hi; }",
  },
  {
    input: b("greet Max", 127, {
      knownFunctions: ["greet"],
      history: ['greet() { echo "Hallo $1"; }'],
    }),
    expectId: "fn-lost",
  },
  {
    input: b("greet", 127, { knownFunctions: ["greet"] }),
    expectId: "fn-lost",
  },
  {
    input: b("begruessen", 127, { history: ["nano funcs.sh", "./funcs.sh"] }),
    expectId: "fn-not-sourced",
    expectFix: "source ./funcs.sh",
  },
  {
    input: b("begruessen", 127, {
      history: ["bash funcs.sh", "source funcs.sh"],
    }),
    expectId: null,
  },
  { input: b("source funcs", 1), expectId: "source-failed" },

  // valid function code: must stay silent
  { input: b("greet () { echo hi; }", 0), expectId: null },
  { input: b("greet() { echo hi; }", 0), expectId: null },
  { input: b("greet(){ echo hi;}", 0), expectId: null },
  { input: b("function greet { echo hi; }", 0), expectId: null },
  { input: b("function greet() { echo hi; }", 0), expectId: null },
  { input: b("greet() {", 0), expectId: null },
  { input: b("f() { if true; then echo y; fi }", 0), expectId: null },
  { input: b("f() { { echo a; } }", 0), expectId: null },
  { input: b("f() { (echo a) }", 0), expectId: null },
  { input: b("f() { echo a & }", 0), expectId: null },
  { input: b('f() { echo "}" ; }', 0), expectId: null },
  { input: b("f() { return $?; }", 0), expectId: null },
  { input: b("f() { local n=$1; return 3; }", 0), expectId: null },
  {
    input: b("greet Max", 0, { knownFunctions: ["greet"] }),
    expectId: null,
  },
  { input: b("x=$(greet)", 0, { knownFunctions: ["greet"] }), expectId: null },

  // ── syntax ─────────────────────────────────────────────────────────────
  { input: b("x = 5", 127), expectId: "assign-spaces", expectFix: "x=5" },
  { input: b("x =5", 127), expectId: "assign-spaces", expectFix: "x=5" },
  { input: b("x= 5", 127), expectId: "assign-spaces", expectFix: "x=5" },
  {
    input: b("name = Max Muster", 127),
    expectId: "assign-spaces",
    expectFix: 'name="Max Muster"',
  },
  { input: b("$x=5", 127), expectId: "assign-dollar", expectFix: "x=5" },
  { input: b("x=5", 0), expectId: null },
  { input: b("x= ls", 0), expectId: null },
  {
    input: b("if[ $x -eq 1 ]; then echo ja; fi", 2),
    expectId: "test-if-glued",
    expectFix: "if [ $x -eq 1 ]; then echo ja; fi",
  },
  {
    input: b("[ $x -eq 1]", 2),
    expectId: "test-bracket-space",
    expectFix: "[ $x -eq 1 ]",
  },
  {
    input: b("if [$x -eq 1 ]; then echo ja; fi", 0),
    expectId: "test-bracket-space",
    expectFix: "if [ $x -eq 1 ]; then echo ja; fi",
  },
  {
    input: b('[["$a" == x]]', 127),
    expectId: "test-bracket-space",
    expectFix: '[[ "$a" == x ]]',
  },
  {
    input: b('if [ "$x" -eq 1 ] then echo ja; fi', 2),
    expectId: "then-semicolon",
    expectFix: 'if [ "$x" -eq 1 ]; then echo ja; fi',
  },
  {
    input: b("for i in 1 2 3 do echo $i; done", 2),
    expectId: "then-semicolon",
    expectFix: "for i in 1 2 3; do echo $i; done",
  },
  {
    input: b('if [ "$x" -gt 3 ]; then echo gross', 130),
    expectId: "block-unclosed",
    expectFix: 'if [ "$x" -gt 3 ]; then echo gross; fi',
  },
  {
    input: b("for f in *.txt; do echo $f", 130),
    expectId: "block-unclosed",
    expectFix: "for f in *.txt; do echo $f; done",
  },
  {
    input: b('[ "$x" > 5 ] && echo gross', 1),
    expectId: "test-redirect",
    expectFix: '[ "$x" -gt 5 ] && echo gross',
  },
  {
    input: b("if [ $n < 10 ]; then echo klein; fi", 0),
    expectId: "test-redirect",
  },
  { input: b('echo "Hallo', 130), expectId: "quote-unclosed" },
  { input: b("echo It's me", 130), expectId: "quote-unclosed" },
  { input: b('echo "Hallo"', 0), expectId: null },
  { input: b("echo 'a \"b' c", 0), expectId: null },
  { input: b('if [ "$x" -eq 1 ]; then echo ja; fi', 0), expectId: null },
  { input: b("[[ $name == M* ]] && echo ok", 0), expectId: null },
  { input: b('[ -f "$f" ] && cat "$f" > out.txt', 0), expectId: null },
  { input: b('[ "${arr[1]}" = x ]', 0), expectId: null },
  { input: b('[ "$a" \\> "$b" ]', 1), expectId: null },
  { input: b("for i in 1 2 3; do echo $i; done", 0), expectId: null },
  { input: b("while true; do sleep 1; done", 130), expectId: null },
  { input: b("echo if then fi", 0), expectId: null },
  { input: b("grep -E 'a|b' file.txt", 1), expectId: null },
  { input: b("echo a=b", 0), expectId: null },
  { input: b("case $x in a) echo a;; *) echo b;; esac", 0), expectId: null },
  { input: b("find . -name '*.sh' -exec chmod +x {} \\;", 0), expectId: null },
  { input: b("{ echo a; echo b; } > out.txt", 0), expectId: null },
  { input: b("[[ $x > 5 ]] && echo y", 1), expectId: null },
  { input: b("(( x > 5 )) && echo gross", 1), expectId: null },
  { input: b("count() { return $#; }", 0), expectId: null },
  { input: b("arr=(1 2 3); echo ${arr[@]}", 0), expectId: null },

  // ── commands ───────────────────────────────────────────────────────────
  { input: b("sl -la", 127), expectId: "cmd-typo", expectFix: "ls -la" },
  {
    input: b("ehco hallo", 127),
    expectId: "cmd-typo",
    expectFix: "echo hallo",
  },
  { input: b("gerp foo a.txt", 127), expectId: "cmd-typo" },
  {
    input: b("gret Max", 127, { knownFunctions: ["greet"] }),
    expectId: "cmd-typo",
    expectFix: "greet Max",
  },
  { input: b("cls", 127), expectId: "cmd-windows", expectFix: "clear" },
  {
    input: b("type notes.txt", 1),
    expectId: "cmd-windows",
    expectFix: "cat notes.txt",
  },
  {
    input: b("Get-ChildItem", 127),
    expectId: "cmd-windows",
    expectFix: "ls",
  },
  { input: b("Get-Service", 127), expectId: "cmd-pwsh-cmdlet" },
  { input: b("sudo apt install tree", 127), expectId: "cmd-not-installed" },
  { input: b("emacs notes.txt", 127), expectId: "cmd-not-installed" },
  {
    input: b("script.sh", 127),
    expectId: "cmd-script-no-dot",
    expectFix: "./script.sh",
  },
  {
    input: b("./script.sh", 126),
    expectId: "cmd-permission",
    expectFix: "chmod +x ./script.sh && ./script.sh",
  },
  { input: b("cd..", 127), expectId: "cd-glued", expectFix: "cd .." },
  {
    input: b("cd Meine Dateien", 1),
    expectId: "cd-failed",
    expectFix: 'cd "Meine Dateien"',
  },
  { input: b("cd dokumente", 1), expectId: "cd-failed" },
  { input: b("cd -", 1), expectId: null },
  { input: b("dir", 0), expectId: null },
  { input: b("type ls", 0), expectId: null },
  { input: b("ls", 0), expectId: null },
  { input: b("ls nix", 2), expectId: null },
  { input: b("grep foo bar.txt", 2), expectId: null },
  { input: b("./script.sh", 127), expectId: null },
  { input: b("./script.sh", 1), expectId: null },
  { input: b("qqqqqq", 127), expectId: null },
  { input: b("cx", 127), expectId: null },
  { input: b("tree", 127), expectId: null },
  { input: b("ls -la", null), expectId: null },
  { input: b("x = 5", null), expectId: null },

  // ── PowerShell ─────────────────────────────────────────────────────────
  {
    input: p('greet() { "hi" }', 1),
    expectId: "ps-bash-function-def",
    expectFix: 'function greet { "hi" }',
  },
  {
    input: p("Add 1,2", 0, {
      knownFunctions: ["add"],
      history: ["function Add($a, $b) { $a + $b }"],
    }),
    expectId: "ps-call-parens",
    expectFix: "Add 1 2",
  },
  {
    input: p('function f($a,$b){ "a=$a b=$b" }; f(1,2)', 0),
    expectId: "ps-call-parens",
    expectFix: 'function f($a,$b){ "a=$a b=$b" }; f 1 2',
  },
  {
    input: p("f()", 1, { knownFunctions: ["f"] }),
    expectId: "ps-call-parens",
    expectFix: "f",
  },
  {
    input: p('greet("Max")', 0, { knownFunctions: ["greet"] }),
    expectId: null,
  },
  {
    input: p("Show 1,2,3", 0, {
      knownFunctions: ["show"],
      history: ["function Show($list) { $list }"],
    }),
    expectId: null,
  },
  {
    input: p("Get-Process -Name pwsh,bash", 0),
    expectId: null,
  },
  {
    input: p('if ($x == 5) { "ja" }', 1),
    expectId: "ps-compare-op",
    expectFix: 'if ($x -eq 5) { "ja" }',
  },
  {
    input: p('if ($x = 5) { "ja" }', 0),
    expectId: "ps-compare-op",
    expectFix: 'if ($x -eq 5) { "ja" }',
  },
  {
    input: p('if ($x > 5) { "gross" }', 0),
    expectId: "ps-compare-op",
    expectFix: 'if ($x -gt 5) { "gross" }',
  },
  {
    input: p("while ($i<3) { $i++ }", 1),
    expectId: "ps-compare-op",
    expectFix: "while ($i -lt 3) { $i++ }",
  },
  { input: p('if ($x -eq 5) { "ja" }', 0), expectId: null },
  { input: p('"a" > out.txt', 0), expectId: null },
  { input: p("if (($r = Get-Date)) { $r }", 0), expectId: null },
  { input: p('$s = "a == b"', 0), expectId: null },
  { input: p("$x += 1", 0), expectId: null },
  {
    input: p("if [ $x -eq 1 ]; then echo ja; fi", 1),
    expectId: "ps-bash-syntax",
    expectFix: "if ($x -eq 1) { echo ja }",
  },
  {
    input: p("for i in 1 2 3; do echo $i; done", 1),
    expectId: "ps-bash-syntax",
  },
  { input: p("$i = 0; do { $i++ } while ($i -lt 3)", 0), expectId: null },
  {
    input: p("export NAME=Max", 1),
    expectId: "ps-export",
    expectFix: '$env:NAME = "Max"',
  },
  { input: p("x=5", 1), expectId: "ps-bash-assign", expectFix: "$x = 5" },
  {
    input: p("source funcs.ps1", 1),
    expectId: "ps-source",
    expectFix: ". ./funcs.ps1",
  },
  {
    input: p("script.ps1", 1),
    expectId: "ps-script-no-dot",
    expectFix: "./script.ps1",
  },
  {
    input: p("Get-ChildItme -Recurse", 1),
    expectId: "ps-cmdlet-typo",
    expectFix: "Get-ChildItem -Recurse",
  },
  { input: p("get-content notes.txt", 1), expectId: null },
  { input: p("Set-Item foo", 1), expectId: null },
  { input: p("ls -la", 0), expectId: null },
  { input: p("cat a.txt | grep foo && echo ok", 0), expectId: null },
  { input: p("$x = $(Get-Date)", 0), expectId: null },
  { input: p("$h = @{ a = 1; b = 2 }", 0), expectId: null },
  { input: p("for ($i = 0; $i -lt 3; $i++) { $i }", 0), expectId: null },
  {
    input: p("if ($x -gt 5) { 'a' } elseif ($x -eq 5) { 'b' } else { 'c' }", 0),
    expectId: null,
  },
  { input: p("Get-Content a.txt > b.txt", 0), expectId: null },
  {
    input: p("Add -a 1 -b 2", 0, {
      knownFunctions: ["add"],
      history: ["function Add($a, $b) { $a + $b }"],
    }),
    expectId: null,
  },
];
