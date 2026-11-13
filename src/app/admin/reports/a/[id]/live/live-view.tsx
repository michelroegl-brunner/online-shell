"use client";

import {
  AlertTriangle,
  ChevronLeft,
  ClipboardX,
  Eye,
  EyeOff,
  Keyboard,
  Lock,
  Megaphone,
  Moon,
  Send,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { WatchTerminal } from "~/components/terminal/watch-terminal";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { formatDateTime, relativeTime } from "~/lib/format";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

type Data = RouterOutputs["manage"]["live"];
type Row = Data["rows"][number];
type Filter = "all" | "attention" | "online" | "offline" | "done";

const POLL_MS = 5_000;
const SYNC_MS = 15_000;

/**
 * Live view of a class working on an assignment: who is online, where
 * they are, their last command, who is stuck or idle. Refreshes itself;
 * command logs are pulled from the boxes every 15 s while it's open.
 */
export function LiveView({ initial }: { initial: Data }) {
  const id = initial.assignment.id;
  const live = api.manage.live.useQuery(
    { assignmentId: id },
    { initialData: initial, refetchInterval: POLL_MS },
  );
  const data = live.data ?? initial;
  const { assignment: a, items, rows, summary } = data;
  const exam = a.mode === "EXAM";

  // Pull fresh commands out of the boxes while this page is open.
  const sync = api.manage.syncCommands.useMutation();
  useEffect(() => {
    const run = () => {
      if (document.visibilityState === "visible")
        sync.mutate({ assignmentId: id });
    };
    run();
    const t = setInterval(run, SYNC_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const [filter, setFilter] = useState<Filter>("all");
  const [watching, setWatching] = useState<Row | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const done = (r: Row) =>
    !!r.submitted || (items.length > 0 && r.solved === items.length);
  const visible = useMemo(() => {
    const list = rows.filter((r) =>
      filter === "all"
        ? true
        : filter === "attention"
          ? r.flags.stuck || r.flags.idle
          : filter === "online"
            ? r.online
            : filter === "offline"
              ? !r.online && !done(r)
              : done(r),
    );
    // Needing attention first, then by name.
    const rank = (r: Row) =>
      r.flags.stuck ? 0 : r.flags.idle ? 1 : done(r) ? 3 : 2;
    return [...list].sort(
      (x, y) =>
        rank(x) - rank(y) || x.student.name.localeCompare(y.student.name, "de"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, items.length]);

  const dueIn = a.dueAt ? new Date(a.dueAt).getTime() - now : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href={`/admin/reports/a/${a.id}`}
          className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> Results
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{a.title}</h1>
          <Badge variant="secondary" className="gap-1.5">
            <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
            live
          </Badge>
          {exam && <Badge variant="destructive">exam</Badge>}
          {dueIn !== null && (
            <span
              className={cn(
                "ml-auto font-mono text-lg tabular-nums",
                dueIn < 5 * 60_000 && "text-amber-400",
                dueIn <= 0 && "text-red-400",
              )}
              title={`Due ${formatDateTime(a.dueAt)}`}
            >
              {dueIn > 0 ? countdown(dueIn) : "time is up"}
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {a.className} · updated {relativeTime(data.at, new Date(now))}
          {!data.runnerReachable && (
            <span className="ml-2 text-amber-400">
              · shell service unreachable: online status unknown
            </span>
          )}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", `All ${summary.students}`],
                [
                  "attention",
                  `Needs attention ${summary.stuck + summary.idle}`,
                ],
                ["online", `Online ${summary.online}`],
                ["offline", "Not working"],
                [
                  "done",
                  exam
                    ? `Handed in ${summary.submitted}`
                    : `Done ${summary.allSolved}`,
                ],
              ] as const
            ).map(([f, label]) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  filter === f
                    ? "border-primary bg-primary/15"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Nobody here.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((r) => (
                <StudentCard
                  key={r.student.id}
                  row={r}
                  items={items}
                  classId={a.classId}
                  now={now}
                  done={done(r)}
                  onWatch={() => setWatching(r)}
                />
              ))}
            </div>
          )}
        </div>

        <BroadcastPanel assignmentId={a.id} />
      </div>

      <Dialog open={!!watching} onOpenChange={(o) => !o && setWatching(null)}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{watching?.student.name}</DialogTitle>
            <DialogDescription>
              {watching?.current
                ? `${watching.current.title}${watching.current.step ? ` · step ${watching.current.step.index + 1}/${watching.current.step.count}` : ""}`
                : "Hasn't started an exercise yet."}
            </DialogDescription>
          </DialogHeader>
          {watching && <WatchTerminal userId={watching.student.id} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StudentCard({
  row: r,
  items,
  classId,
  now,
  done,
  onWatch,
}: {
  row: Row;
  items: Data["items"];
  classId: string;
  now: number;
  done: boolean;
  onWatch: () => void;
}) {
  return (
    <Card
      className={cn(
        "gap-3 py-3",
        r.flags.stuck && "border-red-500/40",
        !r.flags.stuck && r.flags.idle && "border-amber-500/40",
        done && "opacity-75",
      )}
    >
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              r.online ? "bg-emerald-400" : "bg-muted-foreground/30",
            )}
            title={r.online ? "Terminal open" : "No terminal open"}
          />
          <Link
            href={`/admin/reports/student/${r.student.id}?classId=${classId}`}
            className="hover:text-primary min-w-0 flex-1 truncate font-medium"
          >
            {r.student.name}
          </Link>
          <span className="text-muted-foreground text-xs tabular-nums">
            {r.score} pts
          </span>
        </div>

        <div className="flex gap-1">
          {r.items.map((it, i) => (
            <span
              key={it.itemId}
              title={`${i + 1}. ${items[i]?.title ?? ""}: ${it.status === "PASSED" ? "solved" : it.status ? `${it.stepsPassed}/${it.stepCount} steps` : "not started"}`}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                it.status === "PASSED"
                  ? "bg-primary"
                  : it.status
                    ? "bg-amber-400/70"
                    : "bg-muted",
              )}
            />
          ))}
        </div>

        <div className="min-h-10 text-xs">
          {r.submitted ? (
            <span className="text-primary inline-flex items-center gap-1">
              <Lock className="size-3" /> handed in{" "}
              {relativeTime(r.submitted, new Date(now))}
            </span>
          ) : r.current ? (
            <>
              <div className="truncate">
                {r.current.title}
                {r.current.step && (
                  <span className="text-muted-foreground">
                    {" "}
                    ·{" "}
                    {r.current.step.count > 1 &&
                      `step ${r.current.step.index + 1}/${r.current.step.count} · `}
                    {r.current.step.checks} check
                    {r.current.step.checks === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {r.lastCommand && (
                <div className="mt-1 flex items-center gap-2">
                  <code
                    className={cn(
                      "bg-muted/60 min-w-0 flex-1 truncate rounded px-1.5 py-0.5 font-mono",
                      r.lastCommand.exitCode !== null &&
                        r.lastCommand.exitCode !== 0 &&
                        "text-red-400",
                    )}
                    title={r.lastCommand.command}
                  >
                    {r.lastCommand.command}
                  </code>
                  <span className="text-muted-foreground shrink-0">
                    {relativeTime(r.lastCommand.at, new Date(now))}
                  </span>
                </div>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">Not started yet.</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {r.controlled && (
            <Badge variant="secondary" className="gap-1 text-sky-300">
              <Keyboard className="size-3" /> teacher typing
            </Badge>
          )}
          {r.flags.stuck && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="size-3" /> stuck
            </Badge>
          )}
          {r.flags.idle && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/40 text-amber-400"
            >
              <Moon className="size-3" /> idle{" "}
              {r.lastActivity &&
                relativeTime(r.lastActivity, new Date(now)).replace(" ago", "")}
            </Badge>
          )}
          {r.failedRecently > 0 && (
            <span
              className="text-muted-foreground text-xs"
              title="Failed commands in the last 10 minutes"
            >
              {r.failedRecently} failed
            </span>
          )}
          {r.focusLost > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-xs text-amber-400"
              title="Left the exam window"
            >
              <EyeOff className="size-3" />
              {r.focusLost}
            </span>
          )}
          {r.pasteAttempts > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-xs text-red-400"
              title="Blocked paste attempts"
            >
              <ClipboardX className="size-3" />
              {r.pasteAttempts}
            </span>
          )}
          {r.extraMinutes ? (
            <span className="text-muted-foreground text-xs">
              +{r.extraMinutes} min
            </span>
          ) : null}
          <div className="ml-auto flex gap-1">
            {r.current && (
              <Button size="sm" variant="ghost" className="h-7 px-2" asChild>
                <Link href={`/admin/reports/attempt/${r.current.attemptId}`}>
                  Details
                </Link>
              </Button>
            )}
            <Button
              size="sm"
              variant={r.online ? "secondary" : "ghost"}
              className="h-7 px-2"
              onClick={onWatch}
              title={
                r.watchers
                  ? `${r.watchers} watching`
                  : "Watch the terminal (read-only)"
              }
            >
              <Eye /> Watch
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BroadcastPanel({ assignmentId }: { assignmentId: string }) {
  const list = api.manage.announcements.useQuery(
    { assignmentId },
    { refetchInterval: 30_000 },
  );
  const [text, setText] = useState("");
  const send = api.manage.announce.useMutation({
    onSuccess: () => {
      setText("");
      toast.success("Sent to everyone working on this assignment");
      void list.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const del = api.manage.deleteAnnouncement.useMutation({
    onSuccess: () => void list.refetch(),
    onError: (e) => toast.error(e.message),
  });
  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Vienna",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4" /> Message to the class
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) send.mutate({ assignmentId, text });
          }}
        >
          <Textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Hint for step 2: look at find -size"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button
            type="submit"
            size="sm"
            disabled={send.isPending || !text.trim()}
          >
            <Send /> Send
          </Button>
          <span className="text-muted-foreground text-xs">
            Pops up for students on the assignment and exercise pages.
          </span>
        </form>
        {list.data && list.data.length > 0 && (
          <ul className="flex flex-col divide-y border-t text-sm">
            {list.data.map((n) => (
              <li key={n.id} className="flex items-start gap-2 py-2">
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {timeFmt.format(new Date(n.createdAt))}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap">
                  {n.text}
                </span>
                <button
                  type="button"
                  aria-label="Delete message"
                  className="text-muted-foreground hover:text-red-400"
                  onClick={() => del.mutate({ id: n.id })}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function countdown(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
