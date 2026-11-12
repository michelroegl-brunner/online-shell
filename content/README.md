# Exercise content

JSON bundles (`{ format: "online-shell-exercises", version: 1, exercises: [...] }`) that can be imported
in the UI (Exercises → Import) or on the server:

```bash
docker compose -p online-shell -f deploy/docker-compose.yml --env-file /opt/online-shell/.env exec web \
  node deploy/import-exercises.mjs content/exercises/<file>.json <teacher-email> [--overwrite]
```

`*.solutions.md` files hold the reference solutions (for teachers, not imported).
