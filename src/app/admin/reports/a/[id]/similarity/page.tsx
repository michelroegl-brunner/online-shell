import { TRPCError } from "@trpc/server";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/server";

export default async function SimilarityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await api.insights
    .similarity({ assignmentId: id })
    .catch((e: unknown) => {
      if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
      throw e;
    });
  const { assignment: a, pairs, attemptOf } = data;
  const itemTitle = new Map(data.items.map((i) => [i.id, i.title]));
  const stepTitle = new Map(data.steps.map((s) => [s.id, s.title]));
  const multiItem = data.items.length > 1;

  const attemptLink = (userId: string, itemId: string) => {
    const att = attemptOf[userId]?.[itemId];
    return att ? `/admin/reports/attempt/${att}` : null;
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/admin/reports/a/${a.id}`}
          className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> {a.title}
        </Link>
        <h1 className="text-2xl font-semibold">Similar work</h1>
        <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
          Every pair of the {data.students} students who worked on this
          assignment ({a.className}) is compared: the same unusual commands, the
          same mistakes, another student&apos;s personal values (exercise
          variables), steps solved at the same moment. Commands everybody types
          count very little. A high score is a reason to look at the replays —
          not proof.
        </p>
      </div>

      {pairs.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <ShieldCheck className="text-primary size-5" />
            <p className="text-sm">
              No pair stands out
              {data.students < 2 ? " (fewer than two students so far)" : ""}.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {pairs.map((p) => {
            const items = new Set([
              ...p.sharedMistakes.map((x) => x.itemId),
              ...p.sharedRare.map((x) => x.itemId),
              ...p.foreignValues.map((x) => x.itemId),
            ]);
            return (
              <Card key={`${p.a.id}:${p.b.id}`}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-3 text-base">
                    <ScoreBadge score={p.score} />
                    <span>
                      {p.a.name}{" "}
                      <span className="text-muted-foreground">&</span>{" "}
                      {p.b.name}
                    </span>
                    <span className="text-muted-foreground ml-auto text-xs font-normal">
                      overlap {Math.round(p.overlap * 100)}%
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4 text-sm">
                  {p.foreignValues.length > 0 && (
                    <Evidence title="Typed the other student's personal value">
                      {p.foreignValues.map((f, i) => {
                        const who = f.by === "a" ? p.a.name : p.b.name;
                        const owner = f.by === "a" ? p.b.name : p.a.name;
                        return (
                          <li key={i}>
                            <b>{who}</b> used {owner}&apos;s{" "}
                            <code>{f.name}</code> = <code>{f.value}</code>
                            {multiItem && (
                              <span className="text-muted-foreground">
                                {" "}
                                ({itemTitle.get(f.itemId)})
                              </span>
                            )}
                            <Cmd>{f.command}</Cmd>
                          </li>
                        );
                      })}
                    </Evidence>
                  )}
                  {p.sharedMistakes.length > 0 && (
                    <Evidence title="Same failing commands (rare in the class)">
                      {p.sharedMistakes.map((m, i) => (
                        <li key={i}>
                          <Cmd failed>{m.command}</Cmd>
                          {multiItem && (
                            <span className="text-muted-foreground text-xs">
                              {itemTitle.get(m.itemId)}
                            </span>
                          )}
                        </li>
                      ))}
                    </Evidence>
                  )}
                  {p.sharedRare.length > 0 && (
                    <Evidence title="Same unusual commands">
                      {p.sharedRare.map((m, i) => (
                        <li key={i}>
                          <Cmd>{m.command}</Cmd>
                          {multiItem && (
                            <span className="text-muted-foreground text-xs">
                              {itemTitle.get(m.itemId)}
                            </span>
                          )}
                        </li>
                      ))}
                    </Evidence>
                  )}
                  {p.closeSolves.length >= 2 && (
                    <Evidence title="Solved at nearly the same time">
                      {p.closeSolves.map((c) => (
                        <li key={c.stepId}>
                          {stepTitle.get(c.stepId) ?? "step"}{" "}
                          <span className="text-muted-foreground">
                            ({c.seconds} s apart)
                          </span>
                        </li>
                      ))}
                    </Evidence>
                  )}
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="text-muted-foreground">Replays:</span>
                    {[
                      ...(items.size
                        ? items
                        : new Set(data.items.map((i) => i.id))),
                    ].flatMap((itemId) =>
                      [p.a, p.b].map((s) => {
                        const href = attemptLink(s.id, itemId);
                        return href ? (
                          <Link
                            key={`${s.id}:${itemId}`}
                            href={href}
                            className="hover:text-primary underline-offset-2 hover:underline"
                          >
                            {s.name}
                            {multiItem ? ` · ${itemTitle.get(itemId)}` : ""}
                          </Link>
                        ) : null;
                      }),
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "tabular-nums",
        score >= 60
          ? "border-red-500/50 text-red-400"
          : score >= 35
            ? "border-amber-500/50 text-amber-400"
            : "text-muted-foreground",
      )}
      title="0–100: how much evidence there is, not a probability"
    >
      {score}
    </Badge>
  );
}

function Evidence({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
        {title}
      </div>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}

function Cmd({
  children,
  failed,
}: {
  children: React.ReactNode;
  failed?: boolean;
}) {
  return (
    <code
      className={cn(
        "mr-2 block rounded bg-[#0a0a0a] px-2 py-1 font-mono text-xs break-all whitespace-pre-wrap",
        failed ? "text-red-400" : "text-neutral-200",
      )}
    >
      {children}
    </code>
  );
}
