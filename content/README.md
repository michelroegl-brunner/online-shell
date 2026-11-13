# Exercise content

JSON bundles (`{ format: "online-shell-exercises", version: 1, exercises: [...] }`) that can be imported
in the UI (Exercises → Import) or on the server:

```bash
docker compose -p online-shell -f deploy/docker-compose.yml --env-file /opt/online-shell/.env exec web \
  node deploy/import-exercises.mjs content/exercises/<file>.json <teacher-email> [--overwrite]
```

`*.solutions.md` files hold the reference solutions (for teachers, not imported).

`lessons/` holds guided, ungraded **lessons** in the same format (`"kind": "LESSON"`;
without `kind` an entry is a normal exercise). Import them the same way, e.g.
`content/lessons/bash-funktionen.json` (Bash functions, German).

`content/lessons/git.json` holds five Git lessons (German, Bash shell), meant to be done in order:
first repository → branches & merge → merge conflicts → remotes (clone/push/pull, with a local
bare repo `server/projekt.git` standing in for GitHub, since the box has no network) → undoing
mistakes (restore, amend, revert, reset, reflog). They need `git` in the student image
(`runner/images/bash/Dockerfile`; the deploy workflow rebuilds it, locally run
`pnpm --filter @online-shell/runner image:bash`). Matching cheat sheet:
`content/cheatsheets/git-grundlagen.md`.
