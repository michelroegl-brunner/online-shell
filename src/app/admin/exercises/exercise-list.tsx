"use client";

import { Copy, Lock, Plus, Search, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { LessonBadge } from "~/components/learn/badges";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { ImportExport } from "./import-export";

type ShellFilter = "ALL" | "BASH" | "PWSH";
type KindFilter = "ALL" | "EXERCISE" | "LESSON";

export function ExerciseList() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [shell, setShell] = useState<ShellFilter>("ALL");
  const [kind, setKind] = useState<KindFilter>("ALL");
  const [mine, setMine] = useState(false);
  const [archived, setArchived] = useState(false);

  const list = api.exercise.list.useQuery({
    q: q || undefined,
    shell: shell === "ALL" ? undefined : shell,
    kind: kind === "ALL" ? undefined : kind,
    mine,
    archived,
  });
  const duplicate = api.exercise.duplicate.useMutation({
    onSuccess: ({ id }) => {
      toast.success("Exercise duplicated");
      router.push(`/admin/exercises/${id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Exercises</h1>
        <ImportExport />
        <Button asChild>
          <Link href="/admin/exercises/new">
            <Plus /> New exercise
          </Link>
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
          <Input
            placeholder="Search title, slug, tag…"
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
          value={kind}
          onChange={setKind}
          options={[
            ["ALL", "All kinds"],
            ["EXERCISE", "Exercises"],
            ["LESSON", "Lessons"],
          ]}
        />
        <Toggle on={mine} onClick={() => setMine((v) => !v)}>
          Only mine
        </Toggle>
        <Toggle on={archived} onClick={() => setArchived((v) => !v)}>
          Archived
        </Toggle>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="hidden sm:table-cell">Shell</TableHead>
              <TableHead className="hidden md:table-cell">Difficulty</TableHead>
              <TableHead className="hidden md:table-cell">Points</TableHead>
              <TableHead className="hidden lg:table-cell">Author</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {list.data?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-muted-foreground py-8 text-center"
                >
                  No exercises yet.{" "}
                  <Link
                    href="/admin/exercises/new"
                    className="text-primary underline"
                  >
                    Create the first one
                  </Link>
                  .
                </TableCell>
              </TableRow>
            )}
            {list.data?.map((ex) => (
              <TableRow
                key={ex.id}
                className="cursor-pointer"
                onClick={() => router.push(`/admin/exercises/${ex.id}`)}
              >
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    {ex.visibility === "SHARED" ? (
                      <Users
                        className="text-muted-foreground size-3.5"
                        aria-label="Shared"
                      />
                    ) : (
                      <Lock
                        className="text-muted-foreground size-3.5"
                        aria-label="Private"
                      />
                    )}
                    {ex.title}
                    {ex.kind === "LESSON" && <LessonBadge />}
                    <span className="text-muted-foreground text-xs font-normal">
                      {ex.stepCount === 1 ? "1 step" : `${ex.stepCount} steps`}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="text-muted-foreground font-mono text-xs">
                      {ex.slug}
                    </span>
                    {ex.tags.map((t) => (
                      <Badge key={t} variant="outline" className="text-xs">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <ShellBadge shell={ex.shell} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {"●".repeat(ex.difficulty)}
                  <span className="text-muted-foreground/40">
                    {"●".repeat(5 - ex.difficulty)}
                  </span>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {ex.kind === "LESSON" ? "–" : ex.points}
                </TableCell>
                <TableCell className="text-muted-foreground hidden lg:table-cell">
                  {ex.author.name}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Duplicate"
                    title="Duplicate"
                    disabled={duplicate.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      duplicate.mutate({ id: ex.id });
                    }}
                  >
                    <Copy />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

export function ShellBadge({ shell }: { shell: "BASH" | "PWSH" }) {
  return (
    <Badge variant="secondary" className="font-mono">
      {shell === "BASH" ? "bash" : "pwsh"}
    </Badge>
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

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={on ? "secondary" : "ghost"}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
