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

## Routes

| Path | Who | |
|---|---|---|
| `/auth/signin` | everyone | Microsoft sign-in (+ dev login) |
| `/learn` | students | my classes / assignments |
| `/admin` | TEACHER, ADMIN | exercises, classes, assignments, reports |

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
