import { TRPCError } from "@trpc/server";
import { CheckCircle2, ChevronLeft, CircleDot, ClipboardX } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { formatDateTime } from "~/lib/format";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/server";

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Vienna",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const dayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Vienna",
  weekday: "short",
  day: "2-digit",
  month: "short",
});

export default async function AttemptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const a = await api.report.attempt({ id }).catch((e: unknown) => {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const passed = a.status === "PASSED";
  const failedCount = a.commands.filter(
    (c) => c.exitCode !== null && c.exitCode !== 0,
  ).length;
  const pasteAttempts = a.pasteEvents.reduce((n, e) => n + e.count, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/admin/reports/a/${a.assignment.id}`}
          className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> {a.assignment.title}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{a.exercise.title}</h1>
          {passed ? (
            <Badge className="bg-primary/15 text-primary border-primary/30">
              <CheckCircle2 /> solved
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-amber-500/40 text-amber-400"
            >
              <CircleDot /> in progress
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          <Link
            href={`/admin/reports/student/${a.student.id}?classId=${a.assignment.classId}`}
            className="text-foreground hover:text-primary font-medium"
          >
            {a.student.name}
          </Link>{" "}
          · {a.student.email} · {a.assignment.className}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="Points" value={`${a.score ?? 0}/${a.exercise.points}`} />
        <Fact label="Checks" value={a.checks} />
        <Fact label="Hints" value={`${a.hintsUsed}/${a.exercise.hintCount}`} />
        <Fact label="Resets" value={a.resets} />
        <Fact
          label="Commands"
          value={`${a.commands.length} (${failedCount} failed)`}
        />
        <Fact
          label={passed ? "Time to solve" : "Last activity"}
          value={
            passed && a.minutes !== null
              ? `${a.minutes} min`
              : formatDateTime(a.lastActivity)
          }
        />
      </div>

      <p className="text-muted-foreground -mt-3 text-xs">
        Started {formatDateTime(a.startedAt)}
        {a.finishedAt && <> · solved {formatDateTime(a.finishedAt)}</>}
        {a.assignment.dueAt && <> · due {formatDateTime(a.assignment.dueAt)}</>}
      </p>

      {a.pasteEvents.length > 0 && (
        <Card className="border-red-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardX className="size-4 text-red-400" />
              Blocked paste attempts ({pasteAttempts})
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-muted-foreground text-xs">
              Pasting was turned off for this assignment, so nothing was pasted.
              Attempts within 10 s are grouped into one line. &ldquo;Typed too
              fast&rdquo; can also come from very fast typing or a held key.
            </p>
            <ul className="divide-y rounded-md border text-sm">
              {a.pasteEvents.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                >
                  <span className="text-muted-foreground w-36 shrink-0 tabular-nums">
                    {dayFmt.format(new Date(e.at))}{" "}
                    {timeFmt.format(new Date(e.at))}
                  </span>
                  <span className="flex-1">
                    {Object.entries(e.reasons)
                      .filter(([, n]) => n)
                      .map(
                        ([r, n]) =>
                          `${pasteReasonLabel(r)}${n && n > 1 ? ` ×${n}` : ""}`,
                      )
                      .join(", ")}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {e.bytes > 0 && <>{e.bytes} chars · </>}
                    {e.terminal === "playground"
                      ? "playground"
                      : `~/exercises/${e.terminal}`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {a.steps.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Steps ({a.steps.filter((s) => s.status === "PASSED").length}/
              {a.steps.length} solved)
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y p-0">
            {a.steps.map((s) => (
              <details key={s.id} className="group px-6 py-2.5">
                <summary className="flex cursor-pointer list-none items-center gap-3 text-sm">
                  {s.status === "PASSED" ? (
                    <CheckCircle2 className="text-primary size-4 shrink-0" />
                  ) : s.status ? (
                    <CircleDot className="size-4 shrink-0 text-amber-400" />
                  ) : (
                    <span className="text-muted-foreground/40 w-4 text-center">
                      ·
                    </span>
                  )}
                  <span className="flex-1">
                    {s.index + 1}. {s.title}
                  </span>
                  <span className="text-muted-foreground hidden text-xs sm:inline">
                    {s.status
                      ? `${s.checks} checks · ${s.hintsUsed}/${s.hintCount} hints${s.passedAt ? ` · solved ${formatDateTime(s.passedAt)}` : ""}`
                      : "not started"}
                  </span>
                  <span className="w-14 text-right tabular-nums">
                    {s.status === "PASSED" ? s.points : 0}/{s.points}
                  </span>
                </summary>
                <pre className="bg-muted/40 mt-2 rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
                  {s.checkOutput ?? "(not checked yet)"}
                </pre>
              </details>
            ))}
          </CardContent>
        </Card>
      )}

      {a.steps.length <= 1 && a.checkOutput !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Last check output</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted/40 rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
              {a.checkOutput || "(no output)"}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Command history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {a.commands.length === 0 ? (
            <p className="text-muted-foreground px-6 pb-6 text-sm">
              No commands recorded yet. (Commands are collected from the
              student&apos;s shell whenever they check or reset.)
            </p>
          ) : (
            <div className="overflow-x-auto bg-[#0a0a0a] px-4 py-3 font-mono text-xs leading-6">
              {a.commands.map((c, i) => {
                const prev = a.commands[i - 1];
                const newDay =
                  !prev ||
                  dayFmt.format(new Date(prev.at)) !==
                    dayFmt.format(new Date(c.at));
                const gapMin = prev
                  ? (new Date(c.at).getTime() - new Date(prev.at).getTime()) /
                    60_000
                  : 0;
                const failed = c.exitCode !== null && c.exitCode !== 0;
                return (
                  <div key={c.id}>
                    {newDay && (
                      <div className="text-muted-foreground mt-1 mb-1 border-b border-white/10 pb-1">
                        {dayFmt.format(new Date(c.at))}
                      </div>
                    )}
                    {!newDay && gapMin >= 10 && (
                      <div className="text-muted-foreground/60 my-1 text-center">
                        · · · {Math.round(gapMin)} min pause · · ·
                      </div>
                    )}
                    <div className="flex gap-3 whitespace-pre">
                      <span className="text-muted-foreground/60 shrink-0">
                        {timeFmt.format(new Date(c.at))}
                      </span>
                      <span className="shrink-0 text-sky-400">{c.cwd}$</span>
                      <span
                        className={cn(
                          "flex-1",
                          failed ? "text-red-400" : "text-neutral-200",
                        )}
                      >
                        {c.command}
                      </span>
                      {failed && (
                        <span className="shrink-0 text-red-400/80">
                          exit {c.exitCode}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function pasteReasonLabel(reason: string) {
  switch (reason) {
    case "paste":
      return "Paste";
    case "drop":
      return "Drag & drop";
    case "shortcut":
      return "Paste shortcut";
    case "bracketed":
      return "Paste (bypassed browser)";
    case "chunk":
      return "Large input (bypassed browser)";
    case "speed":
      return "Typed too fast";
    default:
      return reason;
  }
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="py-3">
      <CardContent className="px-4">
        <div className="text-muted-foreground text-xs">{label}</div>
        <div className="font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
