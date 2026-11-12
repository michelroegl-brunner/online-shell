import { TRPCError } from "@trpc/server";
import { CheckCircle2, ChevronLeft, CircleDot } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { formatDateTime } from "~/lib/format";
import { api } from "~/trpc/server";

export default async function StudentReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ classId?: string }>;
}) {
  const { id } = await params;
  const { classId } = await searchParams;
  if (!classId) notFound();
  const r = await api.report
    .student({ userId: id, classId })
    .catch((e: unknown) => {
      if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
      throw e;
    });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin/reports"
          className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> Reports
        </Link>
        <h1 className="text-2xl font-semibold">{r.student.name}</h1>
        <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span>{r.student.email}</span>
          <span>· {r.class.name}</span>
          {r.student.groups.map((g) => (
            <Badge key={g} variant="secondary">
              {g}
            </Badge>
          ))}
          {!r.student.inClass && (
            <Badge variant="outline">no longer in class</Badge>
          )}
          <span>
            ·{" "}
            {r.student.lastLoginAt
              ? `last sign-in ${formatDateTime(r.student.lastLoginAt)}`
              : "never signed in"}
          </span>
        </p>
        <p className="mt-2 text-sm">
          Total: <b className="tabular-nums">{r.total}</b>
          <span className="text-muted-foreground">/{r.maxPoints} points</span>
        </p>
      </div>

      {r.assignments.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No assignments for this student yet.
        </p>
      )}

      {r.assignments.map((a) => (
        <Card key={a.id}>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">
              <Link
                href={`/admin/reports/a/${a.id}`}
                className="hover:text-primary"
              >
                {a.title}
              </Link>
              {!a.published && (
                <Badge variant="outline" className="ml-2">
                  draft
                </Badge>
              )}
            </CardTitle>
            <span className="text-sm tabular-nums">
              {a.total}
              <span className="text-muted-foreground">/{a.maxPoints}</span>
            </span>
          </CardHeader>
          <CardContent className="flex flex-col divide-y p-0">
            {a.items.map((it, i) => {
              const t = it.attempt;
              const row = (
                <>
                  {t?.status === "PASSED" ? (
                    <CheckCircle2 className="text-primary size-4 shrink-0" />
                  ) : t ? (
                    <CircleDot className="size-4 shrink-0 text-amber-400" />
                  ) : (
                    <span className="text-muted-foreground/40 w-4 text-center">
                      ·
                    </span>
                  )}
                  <span className="flex-1">
                    {i + 1}. {it.title}
                  </span>
                  <span className="text-muted-foreground hidden text-xs sm:inline">
                    {t
                      ? `${t.checks} checks · ${t.hintsUsed} hints · ${t.resets} resets · ${t.commands} commands${t.pasteAttempts ? ` · ${t.pasteAttempts} blocked pastes` : ""}${t.minutes !== null ? ` · ${t.minutes} min` : ""}`
                      : "not started"}
                  </span>
                  <span className="w-16 text-right tabular-nums">
                    {t?.score ?? 0}/{it.points}
                  </span>
                </>
              );
              return t ? (
                <Link
                  key={it.itemId}
                  href={`/admin/reports/attempt/${t.id}`}
                  className="hover:bg-accent/40 flex items-center gap-3 px-6 py-2.5 text-sm"
                >
                  {row}
                </Link>
              ) : (
                <div
                  key={it.itemId}
                  className="flex items-center gap-3 px-6 py-2.5 text-sm"
                >
                  {row}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
