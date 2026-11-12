# Online Shell

Students solve Bash/PowerShell exercises in a real shell in the browser; teachers
write exercises, assign them to classes (M365 groups) and see reports.
Design: [docs/SKETCH.md](docs/SKETCH.md).

Stack: Next.js 16 · React 19 · tRPC 11 · Prisma 7 (Postgres, `adapter-pg`) ·
Auth.js v5 (Microsoft Entra ID) · Tailwind 4 + shadcn/ui · pnpm.

## Dev setup

```bash
pnpm install
cp .env.example .env        # then set AUTH_SECRET (npx auth secret)
pnpm db:up                  # Postgres 17 in Docker on localhost:5434
pnpm db:generate            # apply migrations
pnpm dev
```

No Docker? Prisma's local Postgres works too:

```bash
pnpm prisma dev --name online-shell --detach
```

Put the printed `postgres://…` URL into `.env.local` as `DATABASE_URL`
(it overrides `.env` for Next.js), and run `pnpm prisma migrate dev` with
the same URL in `DATABASE_URL`.

With `AUTH_DEV_LOGIN="true"` (ignored in production) the sign-in page has a
**Dev login**: enter any email and choose Student / Teacher / Admin. Entra
isn't needed for that.

## Runner (student shells)

`runner/` is a separate Node service that starts one Docker container ("box")
per student and streams a shell to the browser (xterm.js ⇄ WebSocket ⇄
`docker exec` PTY). The web app never touches the Docker socket.

```bash
pnpm --filter @online-shell/runner image:bash   # build oshell-bash:latest
cp runner/.env.example runner/.env               # RUNNER_SECRET = same as in .env
pnpm runner:dev                                  # :4100
```

- **Box**: `oshell-box-<userId>`, one per student, reused across exercises.
  No network, read-only rootfs, 256 MB RAM, 0.5 CPU, 128 PIDs, all caps
  dropped (root exec for setup/check keeps CHOWN/DAC_OVERRIDE/FOWNER),
  `no-new-privileges`, non-root `student` user.
- **Home**: volume `oshell-home-<userId>` at `/home/student`, kept when the box
  is removed. New volumes are seeded from the image's `/home/student`.
- **Cleanup**: boxes with no terminal attached for `IDLE_MINUTES` (15) are
  removed, and every box is removed after `MAX_LIFETIME_MINUTES` (120). A box is
  also recreated when its image was rebuilt.
- **Command log**: bash appends `epoch⇥exit⇥cwd⇥command` to `/run/oshell/cmd.log`
  (hooks in `runner/images/bash/oshell-hooks.sh`). It isn't ingested into the DB yet.
- **Auth**: web → runner REST uses `Bearer RUNNER_SECRET`; browser → runner
  WebSocket uses a 60 s HS256 JWT minted by `box.attach` (subject = session user),
  plus an `ALLOWED_ORIGINS` check.

| Runner API | |
|---|---|
| `GET /health` | Docker reachable? |
| `POST /boxes` `{userId, shell}` | ensure the box is running |
| `POST /boxes/:userId/exec` `{script, interpreter, user, timeoutMs}` | run setup/check scripts |
| `DELETE /boxes/:userId` | remove the box (volume stays) |
| `WS /attach?token=…&cols=…&rows=…` | interactive shell |

## Exercises

Teachers manage exercises under `/admin/exercises` (list, filter, duplicate,
archive). Each exercise has a Markdown description, hints, points, difficulty,
tags, visibility (private / shared with all teachers) and two Bash scripts:

| Script | Runs | Meaning |
|---|---|---|
| **Setup** | as root, `set -e`, in `$OSHELL_DIR` = `~/exercises/<slug>` | The folder is wiped first and chowned to the student afterwards. Use `$RANDOM` to give every student different data. |
| **Check** | as root in `$OSHELL_DIR`, 30 s timeout | **Exit 0 = passed.** Its output is shown to the student. |

Scripts are copied into a root-only temp file in the box, run with stdin from
`/dev/null`, and deleted afterwards, so students can't read the check logic.
Logic: `src/server/exercises/run.ts`.

**Test run** (exercise page): runs setup in the teacher's *own* box, opens a
terminal in the exercise folder, then runs the check.

## Classes

A class is an M365 group. Teachers import groups under `/admin/classes`
(search → Import) and become the class's teacher; more teachers can be added
by email (they must have signed in once as Teacher/Admin). Teachers see only
their own classes; admins see all.

Members come from Microsoft Graph with **app-only** permissions
(`src/server/graph.ts`, client credentials with the same app registration):

- **Application** `Group.Read.All` (search and read groups)
- **Application** `GroupMember.Read.All` (read members)
- admin consent for both

"Sync members" (and the first import) creates missing users as students and
makes the class membership match the group exactly. Teachers/admins in the
group are never counted as students. Students' memberships are also refreshed
whenever they sign in (delegated `/me/transitiveMemberOf`).

**Dev mode:** without the `AUTH_MICROSOFT_ENTRA_ID_*` variables and with
`AUTH_DEV_LOGIN="true"`, the page offers "New dev class" and lets you add
dev-login students by email, so you can test without Microsoft 365.

## Routes

| Path | Who | |
|---|---|---|
| `/auth/signin` | everyone | Microsoft sign-in (+ dev login) |
| `/learn` | students | my classes / assignments |
| `/learn/playground` | everyone | free Bash shell in your own box |
| `/admin` | TEACHER, ADMIN | exercises, classes, assignments, reports |
| `/admin/exercises` | TEACHER, ADMIN | exercise library, editor, test run |
| `/admin/classes` | TEACHER, ADMIN | import M365 groups, members, teachers |

`src/proxy.ts` guards `/learn` and `/admin`; the admin layout checks the role again
on the server. tRPC has `protectedProcedure`, `teacherProcedure`, `adminProcedure`.

## Entra ID app registration

1. **Entra admin center → App registrations → New registration**
   - Name: `Online Shell`, *Accounts in this organizational directory only*
   - Redirect URI (Web): `http://localhost:3000/api/auth/callback/microsoft-entra-id`
     (add the production URL later)
2. **Overview**: copy *Application (client) ID* → `AUTH_MICROSOFT_ENTRA_ID_ID`,
   *Directory (tenant) ID* → `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID`
3. **Certificates & secrets → New client secret** → `AUTH_MICROSOFT_ENTRA_ID_SECRET`
4. **App roles → Create app role** (member types: *Users/Groups*), values exactly:
   `Admin`, `Teacher`, `Student`
5. **API permissions → Microsoft Graph → Delegated**: `User.Read`,
   `GroupMember.Read.All` (+ `openid`, `profile`, `email`) → **Grant admin consent**
6. **Enterprise applications → Online Shell → Users and groups**: assign yourself →
   `Admin`, the teachers group → `Teacher`. Users with no role become students.
   Optional: *Properties → Assignment required = Yes* to limit who can sign in
   (then also assign the student groups → `Student`).

> Assigning app roles to **groups** needs Entra ID P1 (included in M365 A3/A5, not A1).
> Without P1, assign the Teacher/Admin roles to individual users.

On every sign-in the app:
- creates or updates the `User` (key: Entra `oid`), with the role taken from the `roles` claim
- reads the user's groups via Graph (`/me/transitiveMemberOf`) and syncs
  `ClassMembership` for every group that has been imported as a `Class`

## Scripts

| | |
|---|---|
| `pnpm dev` | dev server (Turbopack) |
| `pnpm check` | eslint + tsc |
| `pnpm build` | production build (`output: standalone`) |
| `pnpm db:generate` | create/apply a migration (`prisma migrate dev`) |
| `pnpm db:migrate` | apply migrations (prod) |
| `pnpm db:studio` | Prisma Studio |
