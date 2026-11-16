"use client";

import { ArrowRightLeft, Check, CloudDownload, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { api } from "~/trpc/react";

/** Summary line for a group sync result. */
export function groupSyncSummary(g: {
  groups: number;
  created: number;
  removed: number;
  kept: number;
  studentsMissing: number;
}) {
  const parts = [`${g.groups} group${g.groups === 1 ? "" : "s"}`];
  if (g.created) parts.push(`${g.created} new`);
  if (g.removed) parts.push(`${g.removed} removed`);
  if (g.kept) parts.push(`${g.kept} kept (used by assignments)`);
  if (g.studentsMissing) {
    parts.push(
      `${g.studentsMissing} student${g.studentsMissing === 1 ? "" : "s"} not in this class here — sync members first`,
    );
  }
  return parts.join(", ");
}

/** Import the classes you teach in Wechselplan, with their groups. */
export function WechselplanImportDialog() {
  const router = useRouter();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const classes = api.wechselplan.classes.useQuery(undefined, {
    enabled: open,
    retry: false,
  });
  const importClass = api.wechselplan.importClass.useMutation({
    onSuccess: async (res) => {
      await Promise.all([
        utils.class.invalidate(),
        utils.wechselplan.classes.invalidate(),
      ]);
      toast.success(
        `${res.alreadyImported ? "Class updated" : `Class imported (${res.sync?.students ?? 0} students)`}: ${groupSyncSummary(res.groups)}`,
      );
      setOpen(false);
      router.push(`/admin/classes/${res.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <ArrowRightLeft /> From Wechselplan
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from Wechselplan</DialogTitle>
          <DialogDescription>
            The classes you teach in Wechselplan
            {classes.data?.schoolYear ? ` (${classes.data.schoolYear})` : ""}.
            Importing adds the class (its M365 group) and its Wechselplan groups
            here.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-96 overflow-auto">
          {classes.isLoading && (
            <p className="text-muted-foreground flex items-center justify-center gap-2 py-4 text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </p>
          )}
          {classes.error && (
            <p className="text-destructive py-4 text-sm">
              {classes.error.message}
            </p>
          )}
          {classes.data?.classes.length === 0 && (
            <p className="text-muted-foreground py-4 text-center text-sm">
              Wechselplan lists no classes for you this school year.
            </p>
          )}
          <ul className="divide-y">
            {classes.data?.classes.map((c) => (
              <li
                key={c.externalId ?? c.name}
                className="flex items-center gap-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {c.name}
                    {c.archived && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        archived
                      </Badge>
                    )}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {c.students} students · {c.groups} group
                    {c.groups === 1 ? "" : "s"}
                    {c.weekdays.length ? ` · ${c.weekdays.join(", ")}` : ""}
                  </p>
                </div>
                {!c.externalId ? (
                  <span className="text-muted-foreground text-xs">
                    no M365 group
                  </span>
                ) : c.classId && c.isTeacher ? (
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/admin/classes/${c.classId}`}>
                      <Check /> Imported
                    </Link>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={importClass.isPending}
                    onClick={() =>
                      importClass.mutate({ externalId: c.externalId! })
                    }
                  >
                    {importClass.isPending &&
                    importClass.variables?.externalId === c.externalId ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <CloudDownload />
                    )}
                    {c.classId ? "Join" : "Import"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
