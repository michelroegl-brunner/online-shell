import { ChevronRight, Target } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "~/components/app-header";
import { Badge } from "~/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { LEARN_NAV } from "~/lib/nav";
import { getCurrentUser } from "~/server/auth/current-user";
import { api } from "~/trpc/server";
import { PointsChart } from "./points-chart";

export default async function ProgressPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/signin");
  const p = await api.learn.progress();
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  return (
    <>
      <AppHeader user={user} home="/learn" nav={LEARN_NAV} />
      <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold">Your progress</h1>
          <p className="text-muted-foreground text-sm">
            Across all assignments of your classes.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="Points"
            value={`${p.totals.points}`}
            sub={`of ${p.totals.maxPoints} (${pct(p.totals.points, p.totals.maxPoints)}%)`}
          />
          <Stat
            label="Exercises solved"
            value={`${p.totals.solved}`}
            sub={`of ${p.totals.exercises}`}
          />
          <Stat
            label="Topics"
            value={`${p.tags.length}`}
            sub={
              p.weak.length
                ? `${p.weak.length} to practise`
                : "nothing weak right now"
            }
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Points over time</CardTitle>
            <CardDescription>
              Points from solved steps, added up day by day.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PointsChart data={p.timeline} maxPoints={p.totals.maxPoints} />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="text-muted-foreground size-4" />
                Practise weak topics
              </CardTitle>
              <CardDescription>
                Topics where you solved the fewest steps or needed many checks,
                with open exercises to work on (easiest first).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {p.weak.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  {p.tags.length
                    ? "No weak topics — well done. Try something new in the playground."
                    : "Nothing to show yet."}
                </p>
              )}
              {p.weak.map((w) => (
                <div key={w.tag} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{w.tag}</Badge>
                    <span className="text-muted-foreground text-xs">
                      {Math.round(w.rate * 100)}% of steps solved
                      {w.checksPerStep !== null &&
                        ` · ${w.checksPerStep.toFixed(1)} checks per step`}
                    </span>
                  </div>
                  {w.practice.length === 0 ? (
                    <p className="text-muted-foreground pl-1 text-xs">
                      No open exercise on this topic — practise it in the{" "}
                      <Link href="/learn/playground" className="underline">
                        playground
                      </Link>
                      .
                    </p>
                  ) : (
                    <ul className="flex flex-col">
                      {w.practice.map((it) => (
                        <li key={it.itemId}>
                          <Link
                            href={`/learn/a/${it.assignmentId}/${it.itemId}`}
                            className="hover:bg-accent/40 -mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {it.title}
                              <span className="text-muted-foreground">
                                {" "}
                                · {it.assignment}
                              </span>
                            </span>
                            <span className="text-muted-foreground shrink-0 text-xs">
                              {it.stepsPassed}/{it.steps} steps
                            </span>
                            <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Solved by topic</CardTitle>
              <CardDescription>Exercises solved per tag.</CardDescription>
            </CardHeader>
            <CardContent>
              {p.tags.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nothing to show yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {p.tags.map((t) => {
                    const r = pct(t.solved, t.exercises);
                    return (
                      <li key={t.tag} className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="font-medium">{t.tag}</span>
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {t.solved}/{t.exercises} solved · {t.points}/
                            {t.maxPoints} pts
                          </span>
                        </div>
                        <div
                          className="bg-muted h-1.5 overflow-hidden rounded-full"
                          role="meter"
                          aria-label={`${t.tag}: ${r}% solved`}
                          aria-valuenow={r}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="bg-primary h-full rounded-full"
                            style={{ width: `${r}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="flex flex-col gap-0.5 px-4">
        <span className="text-muted-foreground text-xs">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        <span className="text-muted-foreground text-xs">{sub}</span>
      </CardContent>
    </Card>
  );
}
