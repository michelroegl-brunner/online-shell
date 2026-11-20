# Exercise content

JSON bundles (`{ format: "online-shell-exercises", version: 1, exercises: [...] }`) that can be imported
in the UI (Exercises → Import) or on the server:

```bash
docker compose -p online-shell -f deploy/docker-compose.yml --env-file /opt/online-shell/.env exec web \
  node deploy/import-exercises.mjs content/exercises/<file>.json <teacher-email> [--overwrite]
```

`*.solutions.md` files hold the reference solutions (for teachers, not imported).

`lessons/` holds guided, ungraded **lessons** in the same format (`"kind": "LESSON"`;
without `kind` an entry is a normal exercise). Import them the same way.

**Bash (SYTB, German)** – built from the SYTB-3 lab notes (`01_scripts` … `09_funktionen`):
`content/lessons/bash-sytb.json` holds the starter lesson `bash-00-grundlagen` (ls, cd, cat,
echo/redirects, cp/mv/rm, grep/pipes – not in the notes) and `bash-01-skripte` … `bash-08-funktionen`,
`content/exercises/bash-sytb.json` the matching exercises (`…-ue`, one per lesson; loops have two,
SSH/SCP has none because the box can't reach a server). All are `SHARED` (library). Reference
solutions: `content/exercises/bash-sytb.solutions.md`. Downloads from the notes (word list,
`klassenkassa.csv`, `lager.csv`) are created by the setup scripts; the adduser exercise works on a
`sysroot/` copy of `/etc/passwd` + `/etc/shadow` because students aren't root. The WSL chapter is
left out (Windows host administration, not doable in a box).

**C (German)** – `content/exercises/c-grundlagen.json`: six C exercises (`"shell": "C"`, code editor +
terminal) from Hallo Welt to functions in several files (`c-01-hallo-welt` … `c-06-funktionen`), checked
with **C test cases** (stdin/arguments → expected output, some hidden). All `SHARED`. Reference
solutions: `content/exercises/c-grundlagen.solutions.md` (every test case passes against them).
Cheat sheet: `content/cheatsheets/c-grundlagen.md`. Needs gcc in the student image
(`runner/images/bash/Dockerfile`).

`content/lessons/git.json` holds five Git lessons (German, Bash shell), meant to be done in order:
first repository → branches & merge → merge conflicts → remotes (clone/push/pull, with a local
bare repo `server/projekt.git` standing in for GitHub, since the box has no network) → undoing
mistakes (restore, amend, revert, reset, reflog). They need `git` in the student image
(`runner/images/bash/Dockerfile`; the deploy workflow rebuilds it, locally run
`pnpm --filter @online-shell/runner image:bash`). Matching cheat sheet:
`content/cheatsheets/git-grundlagen.md`.
