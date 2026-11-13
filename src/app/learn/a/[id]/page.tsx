import { TRPCError } from "@trpc/server";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppHeader } from "~/components/app-header";
import { LEARN_NAV } from "~/lib/nav";
import { Announcements } from "~/components/learn/announcements";
import {
  AttemptIcon,
  LessonBadge,
  WindowBadge,
} from "~/components/learn/badges";
import { HandInButton } from "~/components/learn/exam-guard";
import { TestRunBanner } from "~/components/learn/test-run-banner";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { formatDateTime } from "~/lib/format";
import { cn } from "~/lib/utils";
import { getCurrentUser } from "~/server/auth/current-user";
import { api } from "~/trpc/server";

export default async function AssignmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/auth/signin");
  const a = await api.learn.assignment({ id }).catch((e: unknown) => {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
    // Not open yet: the API refuses to return the exercises.
    if (e instanceof TRPCError && e.code === "FORBIDDEN") redirect("/learn");
    throw e;
  });

  const solved = a.items.filter((i) => i.status === "PASSED").length;
  const points = a.items.reduce((s, i) => s + (i.score ?? 0), 0);
  const maxPoints = a.items.reduce((s, i) => s + i.points, 0);

  return (
    <>
      <AppHeader
        user={user}
        home={a.preview ? "/admin" : "/learn"}
        nav={LEARN_NAV}
      />
      <main className="mx-auto max-w-4xl p-4 sm:p-6">
        {a.preview && (
          <TestRunBanner
            assignmentId={a.id}
            published={a.published}
            className="mb-4"
          />
        )}
        <Link
          href={a.preview ? "/admin/assignments" : "/learn"}
          className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> {a.className}
        </Link>
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{a.title}</h1>
          <WindowBadge state={a.state} opensAt={a.opensAt} dueAt={a.dueAt} />
          {a.mode === "EXAM" && <Badge variant="destructive">exam</Badge>}
          {a.mode === "EXAM" && a.state === "open" && !a.preview && (
            <HandInButton assignmentId={a.id} size="sm" className="ml-auto" />
          )}
        </div>
        <p className="text-muted-foreground mb-6 text-sm">
          {solved}/{a.items.length} solved · {points}/{maxPoints} points
          {a.dueAt && <> · due {formatDateTime(a.dueAt)}</>}
          {a.maxChecks !== null && <> · {a.maxChecks} checks per exercise</>}
          {a.state === "closed" && (
            <>
              {" "}
              ·{" "}
              {a.submittedAt
                ? `handed in ${formatDateTime(a.submittedAt)}`
                : "closed"}
              , you can still look at your work
            </>
          )}
        </p>
        {a.mode === "EXAM" && a.state === "open" && !a.preview && (
          <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            Exam: work in fullscreen; leaving the window is recorded. The
            playground and other assignments are locked until you hand in.
            Checks only tell you whether a step is solved.
          </p>
        )}
        <Announcements assignmentId={a.id} className="mb-4" />

        <Card>
          <CardContent className="flex flex-col divide-y p-0">
            {a.items.map((item, i) => {
              const lesson = item.kind === "LESSON";
              const inner = (
                <>
                  {item.lockedBy ? (
                    <Lock
                      className="text-muted-foreground size-5"
                      aria-label="Locked"
                    />
                  ) : (
                    <AttemptIcon status={item.status} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      <span className="text-muted-foreground mr-2">
                        {i + 1}.
                      </span>
                      {item.title}
                    </div>
                    {item.lockedBy && (
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        Finish “{item.lockedBy}” first.
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {lesson && <LessonBadge />}
                      <Badge variant="secondary" className="font-mono">
                        {item.shell === "BASH" ? "bash" : "pwsh"}
                      </Badge>
                      {item.tags.slice(0, 4).map((t) => (
                        <Badge key={t} variant="outline" className="text-xs">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    {/* Lessons are ungraded: no points. */}
                    {!lesson && (
                      <div>
                        {item.score ?? 0}/{item.points} pts
                      </div>
                    )}
                    {item.stepCount > 1 && (
                      <div className="text-muted-foreground text-xs">
                        {item.stepsPassed}/{item.stepCount} steps
                      </div>
                    )}
                    {!lesson && (
                      <div className="text-muted-foreground text-xs">
                        {"●".repeat(item.difficulty)}
                        <span className="opacity-30">
                          {"●".repeat(5 - item.difficulty)}
                        </span>
                      </div>
                    )}
                  </div>
                  {!item.lockedBy && (
                    <ChevronRight className="text-muted-foreground size-4" />
                  )}
                </>
              );
              const row = "flex items-center gap-4 px-4 py-3";
              // Locked behind a gate: not a link (the server refuses it too).
              return item.lockedBy ? (
                <div key={item.id} className={cn(row, "opacity-60")}>
                  {inner}
                </div>
              ) : (
                <Link
                  key={item.id}
                  href={`/learn/a/${a.id}/${item.id}`}
                  className={cn(row, "hover:bg-accent/40")}
                >
                  {inner}
                </Link>
              );
            })}
            {a.items.length === 0 && (
              <p className="text-muted-foreground p-6 text-center text-sm">
                This assignment has no exercises yet.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
