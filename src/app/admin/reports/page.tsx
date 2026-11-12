import { BarChart3, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { formatDateTime } from "~/lib/format";
import { api } from "~/trpc/server";

export default async function ReportsPage() {
  const assignments = await api.assignment.list({});

  const byClass = new Map<
    string,
    { name: string; items: typeof assignments }
  >();
  for (const a of assignments) {
    const entry = byClass.get(a.class.id) ?? { name: a.class.name, items: [] };
    entry.items.push(a);
    byClass.set(a.class.id, entry);
  }
  const classes = [...byClass.values()].sort((x, y) =>
    x.name.localeCompare(y.name, "de"),
  );

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold">Reports</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Results per assignment: who solved what, points, time and the commands
        students typed.
      </p>

      {classes.length === 0 && (
        <Card>
          <CardContent className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
            <BarChart3 className="size-4" /> No assignments yet. Create one
            under{" "}
            <Link href="/admin/assignments" className="text-primary underline">
              Assignments
            </Link>
            .
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-6">
        {classes.map((c) => (
          <Card key={c.name}>
            <CardHeader>
              <CardTitle>{c.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col divide-y p-0">
              {c.items.map((a) => {
                const pct = a.total
                  ? Math.round((a.passed / a.total) * 100)
                  : 0;
                return (
                  <Link
                    key={a.id}
                    href={`/admin/reports/a/${a.id}`}
                    className="hover:bg-accent/40 flex items-center gap-4 px-6 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{a.title}</span>
                        {!a.published && <Badge variant="outline">draft</Badge>}
                        {a.groups.map((g) => (
                          <Badge key={g.id} variant="secondary">
                            {g.name}
                          </Badge>
                        ))}
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        {a.students} students · {a.itemCount} exercises
                        {a.dueAt && <> · due {formatDateTime(a.dueAt)}</>}
                      </div>
                    </div>
                    <div className="w-40">
                      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                        <div
                          className="bg-primary h-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="text-muted-foreground mt-1 text-right text-xs">
                        {pct}% solved ({a.passed}/{a.total})
                      </div>
                    </div>
                    <ChevronRight className="text-muted-foreground size-4" />
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
