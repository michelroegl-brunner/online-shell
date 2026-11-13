"use client";

import { Copy, Eye, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { ShellBadge } from "../exercises/exercise-list";

type Sort = "popular" | "new" | "title";
type ShellFilter = "ALL" | "BASH" | "PWSH";

export function Library() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [shell, setShell] = useState<ShellFilter>("ALL");
  const [tag, setTag] = useState<string | null>(null);
  const [othersOnly, setOthersOnly] = useState(true);
  const [sort, setSort] = useState<Sort>("popular");

  const lib = api.exercise.library.useQuery({
    q: q || undefined,
    shell: shell === "ALL" ? undefined : shell,
    tag: tag ?? undefined,
    othersOnly,
    sort,
  });
  const copy = api.exercise.duplicate.useMutation({
    onSuccess: ({ id }) => {
      toast.success("Copied to your exercises");
      router.push(`/admin/exercises/${id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Shared library</h1>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Exercises other teachers shared. Use them in your assignments as they
        are, or copy one to adapt it (the copy is private and yours).
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
          <Input
            placeholder="Search title, text, tag…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Segmented
          value={shell}
          onChange={setShell}
          options={[
            ["ALL", "All"],
            ["BASH", "Bash"],
            ["PWSH", "PowerShell"],
          ]}
        />
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            ["popular", "Most used"],
            ["new", "Newest"],
            ["title", "A–Z"],
          ]}
        />
        <Button
          type="button"
          size="sm"
          variant={othersOnly ? "secondary" : "ghost"}
          aria-pressed={othersOnly}
          onClick={() => setOthersOnly((v) => !v)}
        >
          Hide mine
        </Button>
      </div>

      {lib.data && lib.data.tags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {lib.data.tags.slice(0, 40).map((t) => (
            <button
              key={t.tag}
              type="button"
              onClick={() => setTag((cur) => (cur === t.tag ? null : t.tag))}
              aria-pressed={tag === t.tag}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs",
                tag === t.tag
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.tag} <span className="opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {lib.isLoading && <p className="text-muted-foreground">Loading…</p>}
      {lib.data?.exercises.length === 0 && (
        <p className="text-muted-foreground py-8 text-center">
          No shared exercises match.
          {othersOnly && " (Your own shared exercises are hidden.)"}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {lib.data?.exercises.map((ex) => (
          <Card key={ex.id} className="gap-3 p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/admin/exercises/${ex.id}`}
                  className="font-medium hover:underline"
                >
                  {ex.title}
                </Link>
                <div className="text-muted-foreground text-xs">
                  {ex.mine ? "you" : ex.author.name} ·{" "}
                  {ex.stepCount === 1 ? "1 step" : `${ex.stepCount} steps`} ·{" "}
                  {ex.kind === "LESSON" ? "lesson" : `${ex.points} pts`} ·{" "}
                  {ex.usedIn === 0
                    ? "not used yet"
                    : `used in ${ex.usedIn} assignment${ex.usedIn === 1 ? "" : "s"}`}
                </div>
              </div>
              <ShellBadge shell={ex.shell} />
            </div>
            {ex.excerpt && (
              <p className="text-muted-foreground line-clamp-3 text-sm">
                {ex.excerpt}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1">
              <span
                className="mr-1 text-xs"
                title={`Difficulty ${ex.difficulty} of 5`}
              >
                {"●".repeat(ex.difficulty)}
                <span className="text-muted-foreground/40">
                  {"●".repeat(5 - ex.difficulty)}
                </span>
              </span>
              {ex.tags.map((t) => (
                <Badge key={t} variant="outline" className="text-xs">
                  {t}
                </Badge>
              ))}
              <div className="ml-auto flex gap-1">
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/admin/exercises/${ex.id}`}>
                    <Eye /> View
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={copy.isPending}
                  onClick={() => copy.mutate({ id: ex.id })}
                >
                  <Copy /> Copy
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="bg-muted inline-flex rounded-md p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "rounded px-3 py-1 text-sm",
            value === v
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
