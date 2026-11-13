"use client";

import { Lock, Plus, Search, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
import { ShellBadge } from "../exercises/exercise-list";
import { BuiltinImport } from "./builtin-import";

type ShellFilter = "ALL" | "BASH" | "PWSH";

export function CheatSheetList() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [shell, setShell] = useState<ShellFilter>("ALL");
  const [mine, setMine] = useState(false);
  const [archived, setArchived] = useState(false);

  const list = api.cheatsheet.list.useQuery({
    q: q || undefined,
    shell: shell === "ALL" ? undefined : shell,
    mine,
    archived,
  });

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Cheat sheets</h1>
        <BuiltinImport />
        <Button asChild>
          <Link href="/admin/cheatsheets/new">
            <Plus /> New cheat sheet
          </Link>
        </Button>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Shown to students next to the terminal for exercises with the same shell
        and at least one matching tag (can be turned off per assignment).
      </p>

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
        <div className="bg-muted inline-flex rounded-md p-0.5">
          {(
            [
              ["ALL", "All"],
              ["BASH", "Bash"],
              ["PWSH", "PowerShell"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setShell(v)}
              className={cn(
                "rounded px-3 py-1 text-sm",
                shell === v
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant={mine ? "secondary" : "ghost"}
          aria-pressed={mine}
          onClick={() => setMine((v) => !v)}
        >
          Only mine
        </Button>
        <Button
          type="button"
          size="sm"
          variant={archived ? "secondary" : "ghost"}
          aria-pressed={archived}
          onClick={() => setArchived((v) => !v)}
        >
          Archived
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="hidden sm:table-cell">Shell</TableHead>
              <TableHead className="hidden md:table-cell">Order</TableHead>
              <TableHead className="hidden lg:table-cell">Author</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {list.error && (
              <TableRow>
                <TableCell colSpan={4} className="text-destructive">
                  {list.error.message}
                </TableCell>
              </TableRow>
            )}
            {list.data?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-muted-foreground py-8 text-center whitespace-normal"
                >
                  No cheat sheets{archived ? " in the archive" : " yet"}.{" "}
                  {!archived && (
                    <>
                      Import the built-in ones or{" "}
                      <Link
                        href="/admin/cheatsheets/new"
                        className="text-primary underline"
                      >
                        write one
                      </Link>
                      .
                    </>
                  )}
                </TableCell>
              </TableRow>
            )}
            {list.data?.map((s) => (
              <TableRow
                key={s.id}
                className="cursor-pointer"
                onClick={() => router.push(`/admin/cheatsheets/${s.id}`)}
              >
                <TableCell className="whitespace-normal">
                  <div className="flex items-center gap-2 font-medium">
                    {s.visibility === "SHARED" ? (
                      <Users
                        className="text-muted-foreground size-3.5 shrink-0"
                        aria-label="Shared"
                      />
                    ) : (
                      <Lock
                        className="text-muted-foreground size-3.5 shrink-0"
                        aria-label="Private"
                      />
                    )}
                    {s.title}
                    <span className="sm:hidden">
                      <ShellBadge shell={s.shell} />
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="text-muted-foreground font-mono text-xs">
                      {s.slug}
                    </span>
                    {s.tags.map((t) => (
                      <Badge key={t} variant="outline" className="text-xs">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <ShellBadge shell={s.shell} />
                </TableCell>
                <TableCell className="hidden tabular-nums md:table-cell">
                  {s.order}
                </TableCell>
                <TableCell className="text-muted-foreground hidden lg:table-cell">
                  {s.author.name}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
