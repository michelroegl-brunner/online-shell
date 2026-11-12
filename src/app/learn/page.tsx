import { ChevronRight, Users } from "lucide-react";
import Link from "next/link";

import { AppHeader } from "~/components/app-header";
import { WindowBadge } from "~/components/learn/badges";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { api } from "~/trpc/server";

export default async function LearnPage() {
  const [me, classes] = await Promise.all([api.me.get(), api.learn.overview()]);

  return (
    <>
      <AppHeader
        user={me}
        home="/learn"
        nav={[{ href: "/learn/playground", label: "Playground" }]}
      />
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <h1 className="mb-1 text-2xl font-semibold">
          Hi {me.name.split(" ")[0]}
        </h1>
        <p className="text-muted-foreground mb-6">Your assignments</p>

        {classes.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No classes yet</CardTitle>
              <CardDescription>
                You are not in any class that uses Online Shell. Your teacher
                has to add your class first; then sign in again.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            {classes.map((c) => (
              <Card key={c.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="text-muted-foreground size-4" />
                    {c.name}
                  </CardTitle>
                  {c.assignments.length === 0 && (
                    <CardDescription>No assignments yet.</CardDescription>
                  )}
                </CardHeader>
                {c.assignments.length > 0 && (
                  <CardContent className="flex flex-col divide-y">
                    {c.assignments.map((a) => {
                      const pct = a.total ? (a.solved / a.total) * 100 : 0;
                      const inner = (
                        <>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{a.title}</span>
                              <WindowBadge
                                state={a.state}
                                opensAt={a.opensAt}
                                dueAt={a.dueAt}
                              />
                            </div>
                            <div className="mt-2 flex items-center gap-3">
                              <div className="bg-muted h-1.5 w-40 overflow-hidden rounded-full">
                                <div
                                  className="bg-primary h-full"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-muted-foreground text-xs">
                                {a.solved}/{a.total} solved · {a.points}/
                                {a.maxPoints} points
                              </span>
                            </div>
                          </div>
                          {a.state !== "upcoming" && (
                            <ChevronRight className="text-muted-foreground size-4" />
                          )}
                        </>
                      );
                      return a.state === "upcoming" ? (
                        <div
                          key={a.id}
                          className="flex items-center gap-3 py-3 opacity-60"
                        >
                          {inner}
                        </div>
                      ) : (
                        <Link
                          key={a.id}
                          href={`/learn/a/${a.id}`}
                          className="hover:bg-accent/40 -mx-2 flex items-center gap-3 rounded-md px-2 py-3"
                        >
                          {inner}
                        </Link>
                      );
                    })}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
