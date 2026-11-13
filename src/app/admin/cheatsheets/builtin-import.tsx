"use client";

import { Loader2, PackageOpen } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { api } from "~/trpc/react";

const STATUS = {
  missing: { label: "new", variant: "default" },
  exists: { label: "exists", variant: "secondary" },
  foreign: { label: "another teacher's", variant: "outline" },
} as const;

/**
 * Import the cheat sheets shipped in content/cheatsheets. By default only
 * missing slugs are created; "Overwrite" also replaces existing ones the
 * caller may edit (teacher edits are lost).
 */
export function BuiltinImport() {
  const [open, setOpen] = useState(false);
  const utils = api.useUtils();
  const builtins = api.cheatsheet.builtins.useQuery(undefined, {
    enabled: open,
  });
  const importBuiltins = api.cheatsheet.importBuiltins.useMutation({
    onSuccess: async (r) => {
      await utils.cheatsheet.invalidate();
      const parts = [
        r.created.length && `${r.created.length} created`,
        r.updated.length && `${r.updated.length} updated`,
        r.skipped.length && `${r.skipped.length} skipped`,
      ].filter(Boolean);
      toast.success(
        parts.length ? `Import: ${parts.join(", ")}` : "Nothing to import.",
      );
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = builtins.data ?? [];
  const missing = rows.filter((r) => r.status === "missing").length;
  const editable = rows.filter((r) => r.status === "exists").length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <PackageOpen /> Import built-in
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import built-in cheat sheets</DialogTitle>
          <DialogDescription>
            Sheets shipped with the app (<code>content/cheatsheets</code>). They
            are created as shared sheets with you as the author.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 overflow-y-auto rounded-md border">
          {builtins.isLoading && (
            <p className="text-muted-foreground p-3 text-sm">Loading…</p>
          )}
          {builtins.error && (
            <p className="text-destructive p-3 text-sm">
              {builtins.error.message}
            </p>
          )}
          {builtins.data?.length === 0 && (
            <p className="text-muted-foreground p-3 text-sm">
              No built-in cheat sheets found.
            </p>
          )}
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.slug} className="flex items-center gap-2 p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.title}</div>
                  <div className="text-muted-foreground truncate font-mono text-xs">
                    {r.slug} · {r.shell === "BASH" ? "bash" : "pwsh"}
                  </div>
                </div>
                <Badge variant={STATUS[r.status].variant}>
                  {STATUS[r.status].label}
                </Badge>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            disabled={importBuiltins.isPending || editable === 0}
            title="Replace existing sheets with the built-in version (your edits are lost)"
            onClick={() => {
              if (
                window.confirm(
                  `Overwrite ${editable} existing sheet(s) with the built-in version? Changes made to them are lost.`,
                )
              )
                importBuiltins.mutate({ overwrite: true });
            }}
          >
            Overwrite existing ({editable})
          </Button>
          <Button
            disabled={importBuiltins.isPending || missing === 0}
            onClick={() => importBuiltins.mutate({ overwrite: false })}
          >
            {importBuiltins.isPending && <Loader2 className="animate-spin" />}
            Import missing ({missing})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
