# Online-Shell – Sketch

Students log in with M365, open exercises for their class, and solve them in a real
Bash or PowerShell terminal in the browser. The teacher writes exercises, assigns them to
classes (M365 groups), and sees reports.

---

## 1. Tech stack (taken from pulsora-core)

| Layer | Choice | Note |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript | same as pulsora |
| API | tRPC 11 + TanStack Query + superjson + zod | same |
| DB | PostgreSQL + Prisma 7 (`@prisma/adapter-pg`) | same |
| Auth | Auth.js v5 (`next-auth@5`) + **Microsoft Entra ID provider** | new: pulsora doesn't use Entra yet |
| UI | Tailwind 4, shadcn/radix, lucide, sonner, react-hook-form | same |
| Charts | recharts | for reports |
| Terminal | **xterm.js** (`@xterm/xterm`, `@xterm/addon-fit`) | new |
| Shell runtime | **separate "runner" service** + Docker (or Incus) containers | new, see §3 |
| Editor (teacher) | Monaco or CodeMirror for check scripts | new |
| Tooling | pnpm, ESLint, Prettier, Playwright | same |
| Deploy | docker-compose: `web`, `runner`, `db` | |

---

## 2. Architecture

```
 Browser (student)                         Browser (teacher)
 ┌─────────────────────┐                   ┌────────────────────┐
 │ Next.js UI          │                   │ Next.js admin UI   │
 │  xterm.js terminal ─┼──── WebSocket ──┐ │  exercise editor   │
 └─────────┬───────────┘                 │ │  reports           │
           │ tRPC                        │ └─────────┬──────────┘
           ▼                             │           │ tRPC
 ┌──────────────────────────────────┐    │           │
 │ web (Next.js)                    │◄───┼───────────┘
 │  Auth.js (Entra) · tRPC · Prisma │    │
 │  issues short-lived session JWT  │    │
 └──────────┬───────────────────────┘    │
            │ HTTP (internal)            ▼
            │                ┌──────────────────────────────┐
            └───────────────►│ runner (Node, ws + dockerode)│
                             │  create/attach/destroy box   │
                             │  stream PTY ⇄ WebSocket      │
                             │  run check script → result   │
                             │  log commands                │
                             └──────────┬───────────────────┘
                                        │ Docker API
                       ┌────────────────┼────────────────┐
                       ▼                ▼                ▼
                 [bash box]       [pwsh box]       [bash box] ... one per active attempt
                  no network, CPU/RAM/PID limits, auto-kill after idle timeout
 ┌──────────┐
 │ Postgres │◄── web + runner
 └──────────┘
```

Why the runner is a separate service: Next.js isn't a good place for long-lived WebSockets
and PTYs, and keeping it separate means the Docker socket never touches the web app.

---

## 3. Big decision: how to "emulate" the shells

| Option | Bash | PowerShell | Accuracy | Effort / Ops | Safety |
|---|---|---|---|---|---|
| **A. Real containers** (Docker/Incus, xterm.js over WS) | real bash | real `pwsh` 7 on Linux | 100% | medium; needs a server | needs sandboxing (fine with limits + no network) |
| B. JS fake shell (virtual FS + hand-written commands) | subset | very poor (objects/pipeline) | low | high, and never done | perfect |
| C. WASM in browser (v86 / container2wasm) | real | not feasible | high for bash | medium; slow start, large download | perfect |

**Recommendation: A.** Students get the real thing, exercises can use any tool, and you
already run Proxmox/Incus. 30 students × ~64–128 MB RAM per box fits easily on one VM.

What A can't do: Windows-only cmdlets (`Get-Service`, registry, `Get-ADUser`, WMI/CIM)
don't exist in pwsh on Linux. Options: (a) limit exercises to cross-platform cmdlets
(files, objects, pipeline, `Select-Object`, `Where-Object`, `Import-Csv`, …), which covers
most of the teaching material; (b) add stub modules into the image that fake
`Get-Service` etc. with canned data; (c) later, a Windows container host. **Start with (a)+(b).**

### Container hardening (runner)
- `--network none`, `--read-only` rootfs + writable tmpfs `/home/student`
- `--memory 128m --cpus 0.5 --pids-limit 128`, non-root user, `no-new-privileges`, drop all caps
- Idle timeout (e.g. 15 min) → destroy; hard max lifetime (e.g. 2 h)
- Per-user limit: max 1–2 live boxes
- Optional: gVisor (`runsc`) runtime for extra isolation

### Images
- `oshell-bash`: debian-slim + coreutils, grep/sed/awk, find, tree, nano, less, jq, man pages
- `oshell-pwsh`: `mcr.microsoft.com/powershell` + stub module + same files

---

## 4. Exercise model

An exercise is **setup → student works → check**.

```yaml
title: "Find the big log files"
shell: bash                # bash | pwsh
difficulty: 2
points: 10
description: |            # Markdown, shown next to the terminal
  In /home/student/logs there are many files. Write all files > 1 MB
  sorted by size into ~/big.txt
setup: |                  # runs as root before the student connects
  mkdir -p /home/student/logs
  for i in $(seq 1 20); do head -c $((RANDOM*100)) /dev/urandom > /home/student/logs/f$i.log; done
  chown -R student: /home/student
check: |                  # runs after "Submit"; exit 0 = pass, stdout = feedback
  expected=$(find /home/student/logs -size +1M -printf '%s %p\n' | sort -n | cut -d' ' -f2)
  diff <(echo "$expected") /home/student/big.txt >/dev/null || { echo "Content of big.txt is not right"; exit 1; }
hints:
  - "Look at `find -size`"
  - "`sort -n` sorts by numbers"
```

Check types (start with 1, add more later):
1. **Script check**: teacher's bash/pwsh script, exit code + message (most flexible)
2. **Output check**: compare the output of the student's last command against a regex or exact value
3. **Command check**: "must use a pipe" / "must not use `ls`", based on the command log

Check scripts are randomised per student (setup uses `$RANDOM`), so students can't copy each other's answers.

---

## 5. Auth & classes (M365)

- Entra **app registration** → Auth.js `MicrosoftEntraID` provider, single tenant.
- **Roles**: Entra *App Roles* `Teacher` / `Student` (in the token's `roles` claim). Simpler and safer than
  guessing from group names. Fallback: everyone not `Teacher` is `Student`.
- **Classes = M365 groups**:
  - Teacher picks a group from a list (Graph `GET /groups?$filter=...`; needs `Group.Read.All` app permission)
    → becomes a `Class` (stores `entraGroupId`).
  - Membership sync: on student login read their groups (`/me/memberOf` or the `groups` claim) and
    update `ClassMembership`. Optional nightly sync job through Graph `/groups/{id}/members` so reports
    show students who haven't logged in yet.

---

## 6. Data model (Prisma, first draft)

```prisma
enum Role       { TEACHER STUDENT }
enum ShellKind  { BASH PWSH }
enum AttemptStatus { IN_PROGRESS PASSED FAILED ABANDONED }

model User {
  id          String   @id @default(cuid())
  entraOid    String   @unique          // Entra object id
  email       String   @unique
  name        String
  role        Role     @default(STUDENT)
  memberships ClassMembership[]
  attempts    Attempt[]
  createdAt   DateTime @default(now())
}

model Class {
  id           String   @id @default(cuid())
  entraGroupId String   @unique
  name         String                   // e.g. "3AHITN"
  schoolYear   String?                  // "2026/27"
  memberships  ClassMembership[]
  assignments  Assignment[]
}

model ClassMembership {
  userId  String
  classId String
  user    User  @relation(fields: [userId], references: [id])
  class   Class @relation(fields: [classId], references: [id])
  @@id([userId, classId])
}

model Exercise {
  id          String    @id @default(cuid())
  title       String
  description String                    // markdown
  shell       ShellKind
  difficulty  Int       @default(1)
  points      Int       @default(10)
  setupScript String
  checkScript String
  hints       String[]
  tags        String[]                  // "find", "pipes", "loops"
  authorId    String
  archived    Boolean   @default(false)
  assignmentItems AssignmentItem[]
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}

// A "Set" of exercises given to a class with a time window (homework, test, practice)
model Assignment {
  id        String   @id @default(cuid())
  title     String
  classId   String
  class     Class    @relation(fields: [classId], references: [id])
  opensAt   DateTime?
  dueAt     DateTime?
  mode      String   @default("PRACTICE") // PRACTICE | TEST (TEST: no hints, single attempt)
  items     AssignmentItem[]
}

model AssignmentItem {
  id           String   @id @default(cuid())
  assignmentId String
  exerciseId   String
  order        Int
  assignment   Assignment @relation(fields: [assignmentId], references: [id])
  exercise     Exercise   @relation(fields: [exerciseId], references: [id])
  attempts     Attempt[]
}

model Attempt {
  id               String        @id @default(cuid())
  userId           String
  assignmentItemId String
  status           AttemptStatus @default(IN_PROGRESS)
  containerId      String?
  startedAt        DateTime      @default(now())
  finishedAt       DateTime?
  checkOutput      String?
  hintsUsed        Int           @default(0)
  submissions      Int           @default(0)
  user             User           @relation(fields: [userId], references: [id])
  assignmentItem   AssignmentItem @relation(fields: [assignmentItemId], references: [id])
  commands         CommandLog[]
}

model CommandLog {
  id        BigInt   @id @default(autoincrement())
  attemptId String
  at        DateTime @default(now())
  command   String
  exitCode  Int?
  attempt   Attempt  @relation(fields: [attemptId], references: [id])
  @@index([attemptId, at])
}
```

Command logging: set `PROMPT_COMMAND` (bash) or a `prompt` function (pwsh) in the image to
write each command and its exit code to a file or FIFO, and have the runner read it. That's more
reliable than parsing raw keystrokes.

---

## 7. Screens

**Student**
- `/` – my classes → open assignments (progress bar per assignment)
- `/a/[assignmentId]` – list of exercises with status (✓ / ✗ / not started)
- `/e/[itemId]` – **split view**: left = task (Markdown) + hints + "Check" button + "Reset box";
  right = terminal (xterm.js). Check result shows as a toast or panel.

**Teacher**
- `/admin/exercises` – library (filter by shell, tag, difficulty), create/edit/duplicate
- `/admin/exercises/[id]` – editor: Markdown, setup + check script (Monaco), **"Test run"** button
  that starts a box, runs setup, opens a terminal for the teacher, and runs the check
- `/admin/classes` – import M365 group → class, see members
- `/admin/assignments` – build assignment (pick exercises, class, time window, mode)
- `/admin/reports`
  - Class × exercise matrix (green/red/grey, click → details)
  - Per student: attempts, time needed, hints used, **command history replay**
  - Per exercise: pass rate, avg. time, most common failing commands (shows what's hard)
  - CSV export (for grades)
- `/admin/live` (later): who's working on what right now, with a read-only view of a student's terminal

---

## 8. Attempt flow

1. Student opens an exercise → `attempt.start` (tRPC) → web calls runner `POST /boxes`
2. Runner starts the container from the image, runs `setupScript` as root, returns `boxId`
3. Web returns a **short-lived signed token** (`{attemptId, boxId, userId}`, 60 s) to the browser
4. Browser opens `wss://runner/attach?token=…` → runner checks the token and attaches the PTY
5. Student works; runner streams the command log to the DB
6. "Check" → `attempt.check` → runner `docker exec` check script → status, output → DB
7. The box stays alive while the student moves on to the next exercise (the runner runs that exercise's setup in the same box).
   When idle, the box is destroyed but the home volume stays. "Reset exercise" recreates only `~/exercises/<slug>/`

---

## 9. MVP cut (in order). Superseded by §14

1. Scaffold (pnpm, Next 16, tRPC, Prisma, Tailwind/shadcn), copied from pulsora conventions
2. Entra login + roles + user upsert
3. Runner: create box (bash only), xterm.js attach over WS, destroy on idle
4. Exercise CRUD + script check + teacher "Test run"
5. Classes from M365 groups + assignments
6. Student flow end-to-end
7. Reports: matrix + per-student detail + CSV
8. pwsh image + stub module
9. Later: command-history replay, live view, test mode lockdown, exercise import/export (YAML),
   exercise sharing between teachers

---

## 10. Decisions (settled 2026-11-11)

| Topic | Decision | Consequence |
|---|---|---|
| Hosting | **Debian VM on the school Proxmox**, Docker + docker-compose (`web`, `runner`, `db`) | Not LXC. Size: ~4 vCPU / 8 GB RAM / 50 GB disk to start |
| Teachers | **Me first, others later** | Roles `ADMIN` / `TEACHER` / `STUDENT`; exercises have an `authorId` + `visibility` (PRIVATE / SHARED); classes have owner teacher(s) |
| Grading | **Points + exam mode** | Points per exercise, sum per assignment, CSV export; `Assignment.mode = PRACTICE \| EXAM` |
| Exam strictness | **Soft lockdown** | See §11 |
| Persistence | **Persistent home dir per student** | Docker volume `home-<userId>` mounted at `/home/student`; see §12 |
| Home layout | **Per-exercise folder** | Setup creates `~/exercises/<slug>/`; check only looks there; rest of `~` belongs to the student |
| Language | **English only** | No i18n layer; plain strings |
| Entra | **I'm tenant admin** | Register app, App Roles, admin consent `Group.Read.All` + `GroupMember.Read.All` (application) myself |

---

## 11. Exam mode (soft lockdown)

- Assignment has `opensAt` / `dueAt`; after `dueAt` the box is frozen and a final check runs automatically
- No hints, `maxChecks` per exercise (e.g. 3), teacher-defined points
- **Persistent home is NOT mounted.** The exam runs in a fresh box with an empty home, so students can't use prepared scripts
- Full-screen exam view; the browser logs `visibilitychange`, `blur` and fullscreen exit as `ExamEvent`s, and the teacher sees them in the report (warning only, no blocking)
- Copy/paste *into* the terminal: optional per exam (`allowPaste`), and paste events are logged
- Teacher live view: who's in, current exercise, number of checks, focus-loss count
- Teacher can extend the time for one student (e.g. for a disadvantage compensation)

---

## 12. Persistent home: details

- One Docker volume per student (`home-<userId>`), created on first box start, mounted at `/home/student`
- **Only one live box per student at a time**, since two boxes on the same volume would conflict. A new exercise reuses the live box (the runner runs the new exercise's setup in it) instead of starting a second one
- Quota: there's no per-volume quota on plain Docker volumes. Either XFS + `pquota` on the VM's volume disk, or a nightly `du` job that warns/blocks above e.g. 200 MB. **Start with the `du` job.**
- Setup scripts run as root but may only write in `~/exercises/<slug>/`; a re-setup ("Reset exercise") deletes and recreates that folder only
- Teacher can open a read-only file browser for a student's home (for help and reports)
- Retention: delete volumes of students who left the class / at the end of the school year (admin action)

---

## 13. Prisma changes from the decisions

```prisma
enum Role           { ADMIN TEACHER STUDENT }
enum Visibility     { PRIVATE SHARED }
enum AssignmentMode { PRACTICE EXAM }

model Exercise {
  // + 
  slug       String     @unique          // folder name: ~/exercises/<slug>
  visibility Visibility @default(PRIVATE)
}

model Class {
  // +
  teachers   ClassTeacher[]               // which teachers own/see this class
}

model ClassTeacher {
  classId String
  userId  String
  @@id([classId, userId])
}

model Assignment {
  // mode: AssignmentMode @default(PRACTICE)
  maxChecks    Int?                       // null = unlimited (practice)
  allowHints   Boolean @default(true)
  allowPaste   Boolean @default(true)
  extensions   AssignmentExtension[]     // per-student extra time
}

model AssignmentExtension {
  assignmentId String
  userId       String
  extraMinutes Int
  @@id([assignmentId, userId])
}

model Attempt {
  // +
  score  Int?                              // points earned
  checks Int @default(0)                   // replaces "submissions"
  events ExamEvent[]
}

model ExamEvent {
  id        BigInt   @id @default(autoincrement())
  attemptId String
  at        DateTime @default(now())
  type      String                         // BLUR | HIDDEN | FULLSCREEN_EXIT | PASTE
  detail    String?
}
```

---

## 14. MVP order (updated)

1. Scaffold (pnpm, Next 16, tRPC, Prisma 7, Tailwind/shadcn), using pulsora conventions
2. Entra app registration + Auth.js login + App Roles → `User` upsert
3. Runner: bash box with persistent home volume, xterm.js over WS, idle shutdown, one box per student
4. Exercise CRUD (slug folder, setup/check, points) + teacher "Test run"
5. Classes from M365 groups (Graph) + class teachers
6. Practice assignments, student flow end-to-end
7. Reports: class × exercise matrix, per-student detail, command log, CSV with points
8. Exam mode (fresh box without home, time window, maxChecks, event logging, live view, extensions)
9. pwsh image + stub module
10. Later: shared library UI for other teachers, home file browser, command replay, YAML import/export
