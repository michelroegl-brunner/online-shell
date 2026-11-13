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
- **Images**: `oshell-bash` (Debian + common CLI tools) and `oshell-pwsh`
  (= bash image + PowerShell 7). The pwsh image ships the module
  `OShellWindows` with stand-ins for Windows-only cmdlets (`Get-Service`,
  `Start-/Stop-/Restart-Service` with state in `/run/oshell`, `Get-CimInstance`
  for Win32_OperatingSystem/ComputerSystem/Processor/LogicalDisk/BIOS incl.
  `-ComputerName`, `Get-ComputerInfo`). A student's box switches image when
  they switch between Bash and PowerShell exercises (same home volume).
- **Command log**: bash (`runner/images/bash/oshell-hooks.sh`) and pwsh
  (`runner/images/pwsh/profile.ps1`) append `epoch⇥exit⇥cwd⇥command` to
  `/run/oshell/cmd.log`; the web app ingests it per attempt.
- **Auth**: web → runner REST uses `Bearer RUNNER_SECRET`; browser → runner
  WebSocket uses a 60 s HS256 JWT minted by `box.attach` (subject = session user),
  plus an `ALLOWED_ORIGINS` check.

| Runner API | |
|---|---|
| `GET /health` | Docker reachable? |
| `POST /boxes` `{userId, shell?}` | ensure the box is running (no `shell`: reuse any running box, else start bash) |
| `POST /boxes/:userId/exec` `{script, interpreter, user, timeoutMs}` | run setup/check scripts |
| `GET /boxes/:userId/download?path=` | stream a file (≤ 50 MB) or a folder as `.tar.gz` (≤ 100 MB), read as the student |
| `GET /sessions` | students with an open terminal (+ last input) for the live view |
| `DELETE /boxes/:userId` | remove the box (volume stays) |
| `WS /attach?token=…&cols=…&rows=…` | interactive shell |
| `WS /watch?token=…` | teacher: view of a student's newest terminal; typing only after the student allows a take-over |

## Exercises

Teachers manage exercises under `/admin/exercises` (list, filter, duplicate,
archive). Each exercise has a Markdown intro, difficulty, tags, visibility
(private / shared with all teachers), one **setup** script and **1..n
steps** ("chained" exercises). Each step has its own task text, **check**
script, hints and points; the exercise is worth the sum. All steps work in
the same folder, so later steps can build on earlier results. Per step the
author decides whether it **unlocks only after the previous step** is
solved (default) or is open right away.

Scoring: a solved step earns its points; an assignment's points override
for an exercise scales the step points proportionally
(`src/server/assignments/scoring.ts`). Progress is stored per step
(`AttemptStep`); `Attempt` keeps the totals.

| Script | Runs | Meaning |
|---|---|---|
| **Setup** | as root, `set -e`, in `$OSHELL_DIR` = `~/exercises/<slug>` | The folder is wiped first and chowned to the student afterwards. Use `$RANDOM` to give every student different data. |
| **Check** | as root in `$OSHELL_DIR`, 30 s timeout | **Exit 0 = passed.** Its output is shown to the student. |

Scripts run with **bash** unless their first line is a pwsh shebang
(`#!/usr/bin/env pwsh`); then they run in PowerShell (setup with
`$ErrorActionPreference = 'Stop'`). They are copied into a root-only temp
file in the box, run with stdin from `/dev/null`, and deleted afterwards, so
students can't read the check logic. Logic: `src/server/exercises/run.ts`.

**Ready-made checks** (`ExerciseStep.checks`, `src/lib/checks.ts`): instead
of (or in addition to) a check script, a step can have typed checks that
are edited as small forms. All of them **and** the script (if it has real
content) must pass.

| Check | Passes when |
|---|---|
| File exists | a file / folder exists (path relative to the exercise folder) |
| File content | a file is exactly / contains a text, or a line matches a regex (`grep -E`) |
| Command output | a command run as root in the folder (10 s; `pwsh` for PowerShell exercises) prints exactly / contains / matches |
| Command used | the student's command log for this attempt has a command matching a JavaScript regex (optionally exit 0 only) |

File and output checks become one generated bash script (values passed
base64-encoded) that runs like a check script; "command used" is decided by
the web app against `CommandLog` and is skipped in teacher test runs.
Every check can have its own failure message. Logic:
`src/server/exercises/checks.ts`.

**Shared library** (`/admin/library`): every SHARED, non-archived exercise
of all teachers, with tag filter, search and "most used". Teachers can use
them in assignments directly or **Copy** one into a private exercise of
their own.

**Import / export**: exercises can be exchanged as JSON bundles
(Exercises → Import / Export, or `deploy/import-exercises.mjs` on the
server). Bundles live in `content/exercises/`; see `content/README.md`.

**Test run** (exercise page): runs setup in the teacher's *own* box, opens a
terminal in the exercise folder, then runs a chosen step's check.

### Lessons

An exercise can be a **lesson** (`Exercise.kind = LESSON`, "Kind" in the
editor, "Lessons" filter in the list): a guided, ungraded walkthrough. Each
step explains one idea in Markdown, shows an example and asks the student to
try it. Differences to a normal exercise:

- **No points**: a lesson is worth 0 in assignments, reports, grades and the
  progress page, whatever its steps or an item override say
  (`src/server/assignments/scoring.ts`). Completion is still tracked
  (attempt `PASSED`), and there is no check limit.
- **Checks itself**: after the student presses Enter in the terminal, the
  page waits ~1 s and calls `learn.autoCheck` (lessons only, one at a time
  per student). A failed auto-check shows nothing and isn't stored; a passed
  one marks the step solved ("✓ Done!") and opens the next. The manual
  **Check** button stays as a fallback.
- **Try it**: fenced code blocks in a lesson's text get a button that types
  the code at the prompt *without* pressing Enter (not while pasting is
  blocked for the student).
- Checks must work on their own: functions or variables the student defines
  interactively don't exist in the check's root shell. Use **command used**
  (regex on the command log, which has the first line of each command) or
  have the student write a file the check runs (`bash -c 'source funcs.sh;
  …'`).

**Gates**: in an assignment, any item can be marked **"Must be done before
the next ones"** (`AssignmentItem.gate`, on by default for lessons). For
students, every later item stays locked until that item is solved: the
assignment page shows a lock and "Finish “…” first", and `learn.item/start/
check/autoCheck/hint/reset` refuse. Teachers' test runs ignore gates.

Lessons live in `content/lessons/` (same bundle format, `"kind": "LESSON"`).

## Cheat sheets

Short topic references (Markdown, German) shown to students in a
collapsible panel next to the terminal (`src/components/learn/cheat-sheet-panel.tsx`).
A sheet appears on an exercise when it has the **same shell** and **at least
one tag** in common with the exercise; several matches are ordered by
`order`, then title. Students can switch sheets, search by section heading
and, where the workspace allows it, insert a code line into the terminal
(without running it).

- **Manage** under `/admin/cheatsheets` (router `cheatsheet`): title, slug,
  shell, tags, order, visibility, Markdown body with live preview; archive
  or delete. SHARED sheets are shown in every class; PRIVATE ones only in
  classes their author teaches (and in the author's own preview).
- **Per assignment**: `Assignment.allowCheatSheet` (on by default) turns
  the panel off, e.g. for exams. Before an assignment opens, or while
  another exam is running for the student, no sheets are returned.
- **Built-in sheets** live in `content/cheatsheets/*.md` with a small
  frontmatter (`slug`, `title`, `shell: BASH|PWSH`, `tags: [a, b]`,
  `order`). Cheat sheets → **Import built-in** reads them at runtime
  (the Docker image copies `content/`) and creates missing slugs as SHARED
  sheets; **Overwrite existing** replaces sheets you may edit with the
  shipped version.

## Classes

A class is an M365 group. Teachers import groups under `/admin/classes`
(search → Import) and become the class's teacher; more teachers can be added
by email (they must have signed in once as Teacher/Admin). Teachers see only
their own classes; admins see all.

Members come from Microsoft Graph with **app-only** permissions
(`src/server/graph.ts`, client credentials with the same app registration):

- **Application** `Group.Read.All` (search and read groups)
- **Application** `GroupMember.Read.All` (read members)
- **Application** `User.ReadBasic.All` (members' names and emails; without
  it Graph returns members with only their id and the sync fails)
- admin consent for all three

"Sync members" (and the first import) creates missing users as students and
makes the class membership match the group exactly. Teachers/admins in the
group are never counted as students. Students' memberships are also refreshed
whenever they sign in (delegated `/me/transitiveMemberOf`).

**Dev classes:** with `AUTH_DEV_LOGIN="true"` (never active in production)
the page also offers "New dev class" and lets you add dev-login students by
email, so you can test without Microsoft 365.

### Groups

A class can be split into **groups** (e.g. "Gruppe A" / "Gruppe B" for lab
lessons) on the class page: create, rename and delete groups, tick students in
a students × groups matrix, or **Split evenly** (N groups, students dealt
alphabetically; replacing existing groups asks first). A student may be in
several groups; only students of the class can be added. When a student
leaves the class (M365 sync, sign-in sync or dev removal), their group
memberships in that class are removed too.

**Assignment targeting**: an assignment with **no groups** goes to the
whole class; with groups, only to students in **at least one** of them. The
rule lives in `assignmentWhereVisibleTo(userId)`
(`src/server/assignments/visibility.ts`).

## Assignments

A teacher puts exercises from the library into an **assignment** for one
class (optionally only some of its groups), with an optional opening/due
time (a per-student extension moves the due time), a check limit and
hints on/off. Students only see **published** assignments; before
`opensAt` they're listed but locked, after `dueAt` read-only.

Student flow (`/learn/a/<assignment>/<item>`, router `learn`):

1. **Open** → `learn.start`: creates the student's attempt (one per student
   and exercise) and runs the exercise **setup** once in their box
   (`~/exercises/<slug>`). Re-opening doesn't wipe their work.
2. Work in the terminal (it starts in the exercise folder).
3. **Check** → `learn.check`: runs the **check** script; exit 0 = solved
   and the item's points are awarded (assignment override or exercise
   default). Later failed checks never take points away. `maxChecks`
   limits checks until solved.
4. **Hints** are revealed one at a time (`hintsUsed` is recorded).
5. **Reset** wipes the folder and re-runs setup (counted in `resets`).

**Command log**: before start/check/reset, the server rotates
`/run/oshell/cmd.log` out of the student's box and stores each line as a
`CommandLog` row on the attempt whose folder (`cwd` under
`~/exercises/<slug>`) it ran in (`src/server/assignments/command-log.ts`).
Commands outside exercise folders are dropped.

Setup/check scripts never reach the browser; students only see what the
check prints.

**Pasting** (`Assignment.allowPaste`, off by default for new assignments):
while any *open* assignment of a student forbids pasting, all their
terminals block it (also the playground, since it's the same box). The
browser blocks paste/drop/Ctrl+V, and the runner (attach-token claim
`paste: false`) drops paste-like input: chunks > 24 bytes, bracketed-paste
markers, and anything above typing speed (token bucket, burst 64 B,
40 B/s). If a no-paste assignment opens while a terminal is connected,
the token's `pasteBlockFrom` makes the runner switch at that time
(`src/server/assignments/paste.ts`). An assignment that is *published*
while a terminal is open applies from the next connect. A deterrent, not a
guarantee: keystroke injectors at human speed can't be detected.

**Paste attempts** are logged for the teacher. The terminal tells the
runner when the browser blocked a paste, drop or paste shortcut; the runner
adds its own drops (bracketed paste, large chunk, faster than typing),
batches them per terminal (10 s window) and posts them to
`/api/runner/paste-events` (bearer `RUNNER_SECRET`, runner env `WEB_URL`;
Caddy doesn't forward `/api/runner/*`). They become `ExamEvent`s of type
`PASTE` on the attempt of the exercise the terminal was opened in, or else
the student's most recently active attempt in an open no-paste assignment
(`src/server/assignments/paste-events.ts`); with no attempt yet they are
dropped. Reports show a count per cell and a list on the attempt page.

## Command explanations

Under the terminal, students get a short German "what probably went wrong"
for their latest failed (or classic-mistake) commands
(`ErrorExplainer`, router `explain.recent`). Off in exam mode, when the
assignment has hints off, before the attempt exists, and while any exam is
open for the student.

- **Rules** (`src/lib/explain/`, pure, no server imports): only the command
  text and exit code are known (stderr isn't logged), so each rule fires
  only on an unambiguous pattern — bash functions (`{echo`, missing `;`
  before `}`, `greet()` / `greet(Max)` calls, `return "text"`, `local`
  outside a function, functions lost in a new shell or not `source`d),
  syntax (`x = 5`, `$x=5`, `[ $x -eq 1]`, `] then`, missing `fi`/`done`,
  open quotes, `>` inside `[ ]`), commands (typos via edit distance incl.
  the student's own functions, Windows/PowerShell commands in bash, not
  installed tools, `./` and `chmod +x`, `cd`) and PowerShell (`==`, `=`/`>`
  in `if (…)`, `f(1,2)` / `f 1,2`, bash syntax, `export`, `source`). First
  matching rule wins. Test cases: `src/lib/explain/explain.test-cases.ts`.
- **Flow**: the page bumps `trigger` after each command; ~1.2 s later the
  query ingests the command log, explains the attempt's last 15 commands
  (functions defined earlier count as known) and returns at most 5,
  newest first. Bash exercises also get `bash -n` (syntax check, never
  run) for `*.sh` files in the exercise folder changed in the last
  10 minutes. Dismissed items stay hidden (sessionStorage).

## Teacher tools

Router `manage` (actions) and `insights` (read-only analysis); same access
as reports (classes you teach, admins all).

- **Live view** (`/admin/reports/a/<id>/live`): one card per student with
  online status (runner `GET /sessions`), current exercise/step, last
  command, progress, and flags — **stuck** (≥ 3 checks on the current step
  or ≥ 5 failed commands in 10 min) and **idle** (no activity for 10 min).
  Polls every 5 s. **Live commands**: the shell hooks also print each
  finished command as a private OSC sequence (`ESC ] 7337 ; base64 BEL`);
  the runner strips it from the terminal output and keeps the last 30 per
  student in memory (`runner/src/commands.ts`, exposed via `GET /sessions`),
  so the live view is seconds behind, not one check behind. CommandLog is
  still filled from `cmd.log`: while the page is open, every 15 s for
  students with an open terminal (throttled per student).
- **Watch** a student's terminal read-only (runner `WS /watch`, 60 s JWT
  `aud: oshell-watch`, minted only for students of your classes). The runner
  keeps 128 KB of scrollback per terminal and replays it; the watcher follows
  the student's newest terminal. The student sees "Teacher is watching".
  **Take over**: the teacher asks, the student's terminal shows Allow / Deny;
  only after Allow are the teacher's keystrokes written to that terminal.
  The student can take control back at any time; it also ends when the
  teacher releases it, closes the view or the terminal changes. Commands
  typed meanwhile are logged as the student's.
- **Messages to the class** (`Announcement`): sent from the live view, shown
  as a banner + toast on the student's assignment and exercise pages.
- **Per student**: extra time (`AssignmentExtension`, from the results
  table or the attempt page), extra checks per step (`Attempt.extraChecks`),
  manual points (`Attempt.scoreOverride` wins over the computed score until
  cleared), feedback shown on the exercise page, **reset attempt** (deletes
  it; the next open runs the setup again), reopen a handed-in exam.
- **Results**: auto-refresh, CSV per exercise / per step / with grades.
  The grade scale (default 87.5 / 75 / 62.5 / 50 % for 1–4) is stored in
  the browser.
- **Solutions** (`/admin/reports/a/<id>/solutions`): per step, the last
  successful non-trivial command before it passed, grouped by identical
  text; identical long commands (≥ 40 chars, ≥ 2 students) are marked.
- **Exercise analytics** (exercise page): pass rate, checks, hints and median
  time per step across all assignments (aggregates only), with flags for
  steps few solve, that need many checks, or take ≥ 3× longer than usual.
- **Dashboard** (`/admin`): running assignments, stuck students (last 24 h),
  what opens / publishes / is due in the next 7 days, exercises worth a look.
- **Scheduled publishing** (`Assignment.publishAt`): a draft becomes visible
  at that time; decided at query time in `assignmentWhereVisibleTo`, no job.
  "Publish when it opens" sets it to the opening time, so students see
  nothing before (not even a locked entry).

### Exam mode

`Assignment.mode = EXAM` (`src/server/assignments/exam.ts`):

- The exercise page asks for fullscreen; window blur (with seconds away),
  hidden tab and leaving fullscreen are stored as `ExamEvent`s and shown in
  reports. Logged, not prevented.
- Check output is hidden (only "passed" / "not solved yet").
- While an exam is open for a student and not handed in, their box only
  serves that exam: `box.attach` refuses other terminals (playground, other
  assignments) and `learn.start/check/reset` refuse other assignments.
- **Hand in** (`AssignmentSubmission`) closes the exam for that student
  until a teacher reopens it.

## Routes

| Path | Who | |
|---|---|---|
| `/auth/signin` | everyone | Microsoft sign-in (+ dev login) |
| `/learn` | students | my classes / assignments with progress |
| `/learn/a/[id]` | students | one assignment: exercises + my status |
| `/learn/a/[id]/[itemId]` | students | task, hints, terminal, check, reset |
| `/learn/playground` | everyone | free Bash shell in your own box |
| `/learn/progress` | everyone | my points over time, solved per tag, weak topics with open exercises to practise |
| `/learn/files` | everyone | browse / preview / download my home folder |
| `/admin` | TEACHER, ADMIN | exercises, classes, assignments, reports |
| `/admin/exercises` | TEACHER, ADMIN | exercise library, editor, test run |
| `/admin/library` | TEACHER, ADMIN | shared exercises of all teachers: browse, filter by tag, copy |
| `/admin/files/[userId]` | TEACHER, ADMIN | a student's home folder (teachers of one of the student's classes), linked from student and attempt reports |
| `/admin/classes` | TEACHER, ADMIN | import M365 groups, members, teachers, groups |
| `/admin/assignments` | TEACHER, ADMIN | create / edit / publish assignments |
| `/admin/reports` | TEACHER, ADMIN | results per assignment (matrix, CSV, per-exercise stats), per student, per attempt (command history, teacher actions) |
| `/admin/reports/a/[id]/live` | TEACHER, ADMIN | live class view, watch terminals, messages |
| `/admin/reports/a/[id]/solutions` | TEACHER, ADMIN | solutions compared per step |

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
   `GroupMember.Read.All` (+ `openid`, `profile`, `email`); **Application**:
   `Group.Read.All`, `GroupMember.Read.All`, `User.ReadBasic.All` →
   **Grant admin consent**
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
