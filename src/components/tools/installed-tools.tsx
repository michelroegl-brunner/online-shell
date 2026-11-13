"use client";

import { Loader2, Search, Wrench } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const MAX_SHOWN = 600;

/**
 * Searchable list of what's installed in the student boxes (read live
 * from the image new boxes get, extras included): commands on the PATH and
 * Debian packages. Missing something → Admin → Tools.
 */
export function InstalledTools({
  shell,
  className,
}: {
  shell: "BASH" | "PWSH";
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [view, setView] = useState<"binaries" | "packages">("binaries");
  const tools = api.tools.installed.useQuery(
    { shell },
    { staleTime: 5 * 60_000, refetchOnWindowFocus: false },
  );

  const term = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const all = tools.data?.[view] ?? [];
    return term ? all.filter((t) => t.toLowerCase().includes(term)) : all;
  }, [tools.data, view, term]);
  const exact = term !== "" && shown.some((t) => t.toLowerCase() === term);

  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border p-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Wrench className="size-4" /> Installed in the{" "}
          {shell === "PWSH" ? "PowerShell" : "Bash"} box
        </span>
        <div className="ml-auto flex rounded-md border p-0.5 text-xs">
          {(["binaries", "packages"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "rounded px-2 py-0.5",
                view === v
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground",
              )}
            >
              {v === "binaries" ? "Commands" : "Packages"}
              {tools.data && (
                <span className="ml-1 opacity-60">{tools.data[v].length}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            view === "binaries"
              ? "Is it installed? e.g. wget, jq, python3"
              : "Search packages"
          }
          className="pl-8"
        />
      </div>
      {tools.isLoading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Reading the box image…
        </p>
      ) : tools.error ? (
        <p className="text-destructive text-sm">{tools.error.message}</p>
      ) : (
        <>
          {term && (
            <p className="text-sm">
              {exact ? (
                <span className="text-emerald-400">
                  ✓ <code className="font-mono">{term}</code> is installed.
                </span>
              ) : (
                <span className="text-muted-foreground">
                  <code className="font-mono">{term}</code> is not installed
                  {shown.length > 0 && " (similar names below)"}.{" "}
                  <Link
                    href={`/admin/tools?add=${encodeURIComponent(term)}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    Install a package…
                  </Link>
                </span>
              )}
            </p>
          )}
          <div className="max-h-56 overflow-auto">
            <ul className="flex flex-wrap gap-1">
              {shown.slice(0, MAX_SHOWN).map((t) => (
                <li
                  key={t}
                  className={cn(
                    "bg-muted rounded px-1.5 py-0.5 font-mono text-xs",
                    t.toLowerCase() === term && "ring-1 ring-emerald-400",
                  )}
                >
                  {t}
                </li>
              ))}
            </ul>
            {shown.length > MAX_SHOWN && (
              <p className="text-muted-foreground mt-1 text-xs">
                …and {shown.length - MAX_SHOWN} more. Search to narrow it down.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
