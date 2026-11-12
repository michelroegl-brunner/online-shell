# Deployment: shell.htl-braunau.at

| What | Where |
|---|---|
| Server | LXC **147 `online-shell`** on Proxmox **prox5** (10.10.10.224), IP **10.10.10.230**, Debian 12, unprivileged + `nesting,keyctl`, Docker CE |
| Public TLS | Edge proxy **CT 145 `htlsrv-proxy-caddy`** (prox4, 10.10.10.250) → `https://10.10.10.230:443` |
| App stack | `deploy/docker-compose.yml`: `db` (Postgres 17), `web` (Next.js), `runner`, `caddy` (internal TLS on :443, HTTP on :80) |
| Student boxes | sibling containers on the same Docker daemon (`oshell-box-*`, volumes `oshell-home-*`) |
| Secrets | `/opt/online-shell/.env` on the server (mode 600, template: `deploy/env.example`) |
| Deploy | push to `main` → GitHub Actions job on the **self-hosted runner inside the LXC** (label `online-shell`) → `.github/workflows/deploy.yml` |

## What a deploy does

1. `docker build -t oshell-bash:latest runner/images/bash` (student box image)
2. `docker compose -p online-shell -f deploy/docker-compose.yml --env-file /opt/online-shell/.env up -d --build`
3. `web` runs `prisma migrate deploy` on start, then the job waits until `/auth/signin` answers.

Running boxes are replaced automatically on their next use if the box image changed.

## Manual operations (on 10.10.10.230)

```bash
cd /opt/online-shell/actions-runner/_work/online-shell/online-shell   # last checkout
docker compose -p online-shell -f deploy/docker-compose.yml --env-file /opt/online-shell/.env ps
docker compose -p online-shell -f deploy/docker-compose.yml --env-file /opt/online-shell/.env logs -f web runner
docker ps --filter label=oshell.managed=1          # student boxes
```

Database backup:

```bash
docker compose -p online-shell -f deploy/docker-compose.yml --env-file /opt/online-shell/.env \
  exec -T db pg_dump -U oshell oshell | gzip > /root/oshell-$(date +%F).sql.gz
```

## Entra

Redirect URIs of the app registration "Online Shell":
`http://localhost:3000/api/auth/callback/microsoft-entra-id` (dev) and
`https://shell.htl-braunau.at/api/auth/callback/microsoft-entra-id` (prod).
