import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarClock,
  ClipboardList,
  Plus,
  SquareTerminal,
  Users,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { formatDateTime, relativeTime } from "~/lib/format";
import { api } from "~/trpc/server";

const SECTIONS = [
  { title: "Exercises", icon: SquareTerminal, href: "/admin/exercises" },
  { title: "Classes", icon: Users, href: "/admin/classes" },
  { title: "Assignments", icon: ClipboardList, href: "/admin/assignments" },
  { title: "Reports", icon: BarChart3, href: "/admin/reports" },
];

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const d = await api.insights.dashboard();
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Teacher dashboard</h1>
        <Button asChild>
          <Link href="/admin/assignments/new">
            <Plus /> New assignment
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="text-primary size-5" /> Running now
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {d.running.length === 0 ? (
            <p className="text-muted-foreground px-6 pb-2 text-sm">
              Nothing is running right now. Assignments show up here while
              students are working on them or shortly before they are due.
            </p>
          ) : (
            <ul className="divide-y">
              {d.running.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 px-6 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {a.title}
                      {a.mode === "EXAM" && (
                        <Badge variant="destructive">exam</Badge>
                      )}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {a.className}
                      {a.activeStudents > 0 && (
                        <>
                          {" "}
                          ·{" "}
                          <span className="text-emerald-400">
                            {a.activeStudents} active
                          </span>
                        </>
                      )}{" "}
                      · {a.started} started · {a.passed} exercises solved
                      {a.dueAt && <> · due {relativeTime(a.dueAt, now)}</>}
                    </div>
                  </div>
                  <Button size="sm" asChild>
                    <Link href={`/admin/reports/a/${a.id}/live`}>
                      <Activity /> Live view
                    </Link>
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/admin/reports/a/${a.id}`}>Results</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-red-400" /> Students who are
              stuck
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {d.stuck.length === 0 ? (
              <p className="text-muted-foreground px-6 pb-2 text-sm">
                Nobody has failed a step 3+ times in the last 24 hours.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {d.stuck.map((s) => (
                  <li key={s.attemptId}>
                    <Link
                      href={`/admin/reports/attempt/${s.attemptId}`}
                      className="hover:bg-accent/40 flex items-center gap-3 px-6 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{s.student}</div>
                        <div className="text-muted-foreground truncate text-xs">
                          {s.exercise} · {s.step} · {s.assignment}
                        </div>
                      </div>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {s.checks} checks · {s.hintsUsed} hints ·{" "}
                        {relativeTime(s.at, now)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4" /> Coming up (7 days)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {d.upcoming.length === 0 ? (
              <p className="text-muted-foreground px-6 pb-2 text-sm">
                Nothing opens, publishes or is due this week.
                {d.drafts > 0 && (
                  <>
                    {" "}
                    You have {d.drafts} draft{d.drafts === 1 ? "" : "s"}.
                  </>
                )}
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {d.upcoming.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/admin/assignments/${a.id}`}
                      className="hover:bg-accent/40 flex items-center gap-3 px-6 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 truncate font-medium">
                          {a.title}
                          {a.mode === "EXAM" && (
                            <Badge variant="destructive">exam</Badge>
                          )}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {a.className}
                        </div>
                      </div>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {a.publishAt
                          ? `publishes ${formatDateTime(a.publishAt)}`
                          : a.opensAt && a.opensAt > now
                            ? `opens ${formatDateTime(a.opensAt)}`
                            : `due ${formatDateTime(a.dueAt)}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {d.hardSteps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SquareTerminal className="size-4 text-amber-400" /> Exercises
              worth a look
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y text-sm">
              {d.hardSteps.map((s) => (
                <li key={`${s.exerciseId}-${s.step}`}>
                  <Link
                    href={`/admin/exercises/${s.exerciseId}`}
                    className="hover:bg-accent/40 flex items-center gap-3 px-6 py-2"
                  >
                    <div className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{s.exercise}</span>
                      <span className="text-muted-foreground"> · {s.step}</span>
                    </div>
                    <span className="shrink-0 text-xs text-amber-400">
                      {Math.round(s.passRate * 100)}% solve it
                      {s.avgChecks !== null &&
                        ` · ${s.avgChecks.toFixed(1)} checks`}{" "}
                      <span className="text-muted-foreground">
                        ({s.started} students)
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SECTIONS.map((s) => (
          <Link key={s.title} href={s.href}>
            <Card className="hover:border-primary/50 py-4 transition-colors">
              <CardContent className="flex items-center gap-2 px-4 font-medium">
                <s.icon className="text-primary size-4" />
                {s.title}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
