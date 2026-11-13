import { TRPCError } from "@trpc/server";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { api } from "~/trpc/server";

export default async function SolutionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await api.insights
    .solutions({ assignmentId: id })
    .catch((e: unknown) => {
      if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
      throw e;
    });
  const { assignment: a, items } = data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/admin/reports/a/${a.id}`}
          className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> {a.title}
        </Link>
        <h1 className="text-2xl font-semibold">Solutions</h1>
        <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
          For every solved step: the last successful command before the check
          passed (looking around like <code>ls</code> or <code>cd</code> is
          skipped), grouped by identical text. Long commands typed identically
          by several students are marked — worth a look, not proof.{" "}
          {a.className}.
        </p>
      </div>

      {items.map((it, i) => (
        <section key={it.itemId} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">
            {i + 1}. {it.title}
          </h2>
          {it.steps.map((st, j) => (
            <Card key={st.stepId}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {it.steps.length > 1 && (
                    <span className="text-muted-foreground">Step {j + 1}:</span>
                  )}
                  {st.title}
                  <Badge variant="secondary" className="ml-auto">
                    {st.solved} solved · {st.groups.length} different
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {st.solved === 0 && (
                  <p className="text-muted-foreground text-sm">
                    Nobody solved this step yet.
                  </p>
                )}
                {st.groups.map((g) => (
                  <div
                    key={g.command}
                    className={
                      g.suspicious
                        ? "rounded-md border border-amber-500/40 bg-amber-500/5 p-2"
                        : "rounded-md border p-2"
                    }
                  >
                    <div className="flex items-start gap-2">
                      <code className="min-w-0 flex-1 font-mono text-xs break-all whitespace-pre-wrap">
                        {g.command}
                      </code>
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        ×{g.students.length}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      {g.suspicious && (
                        <span className="inline-flex items-center gap-1 text-amber-400">
                          <AlertTriangle className="size-3" /> identical
                        </span>
                      )}
                      {g.students.map((s) => (
                        <Link
                          key={s.attemptId}
                          href={`/admin/reports/attempt/${s.attemptId}`}
                          className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                        >
                          {s.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
                {st.unknown.length > 0 && (
                  <p className="text-muted-foreground text-xs">
                    No command recorded for:{" "}
                    {st.unknown.map((s, k) => (
                      <span key={s.attemptId}>
                        {k > 0 && ", "}
                        <Link
                          href={`/admin/reports/attempt/${s.attemptId}`}
                          className="hover:text-foreground hover:underline"
                        >
                          {s.name}
                        </Link>
                      </span>
                    ))}{" "}
                    (e.g. solved in an editor or before command logging).
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </section>
      ))}
    </div>
  );
}
