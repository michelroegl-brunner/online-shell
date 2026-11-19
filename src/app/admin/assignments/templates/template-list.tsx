"use client";

import { CalendarPlus, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { api } from "~/trpc/react";
import {
  type UseTemplateTarget,
  UseTemplateDialog,
} from "./use-template-dialog";

export function TemplateList() {
  const router = useRouter();
  const list = api.template.list.useQuery();
  const [target, setTarget] = useState<UseTemplateTarget | null>(null);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <Link
            href="/admin/assignments"
            className="text-muted-foreground text-sm hover:underline"
          >
            Assignments
          </Link>
          <h1 className="text-2xl font-semibold">Templates</h1>
          <p className="text-muted-foreground text-sm">
            Exercises and rules prepared once; assign them to a class or group
            with just the dates.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/assignments/templates/new">
            <Plus /> New template
          </Link>
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="hidden md:table-cell">Exercises</TableHead>
              <TableHead className="hidden sm:table-cell">Owner</TableHead>
              <TableHead className="w-10" />
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
            {list.data?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-muted-foreground py-8 text-center"
                >
                  No templates yet.{" "}
                  <Link
                    href="/admin/assignments/templates/new"
                    className="text-primary underline"
                  >
                    Create one
                  </Link>{" "}
                  or use “Save as template” on an assignment.
                </TableCell>
              </TableRow>
            )}
            {list.data?.map((t) => (
              <TableRow
                key={t.id}
                className="cursor-pointer"
                onClick={() =>
                  router.push(`/admin/assignments/templates/${t.id}`)
                }
              >
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {t.title}
                    {t.mode === "EXAM" && (
                      <Badge variant="destructive" className="text-xs">
                        exam
                      </Badge>
                    )}
                    {t.visibility === "SHARED" && (
                      <Badge variant="outline" className="text-xs">
                        shared
                      </Badge>
                    )}
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    {t.exercises.length} exercise
                    {t.exercises.length === 1 ? "" : "s"} · {t.points} pts
                    {t.durationMinutes ? ` · ${t.durationMinutes} min` : ""}
                  </div>
                  {t.description && (
                    <div className="text-muted-foreground mt-1 line-clamp-1 text-xs">
                      {t.description}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground hidden max-w-sm text-sm md:table-cell">
                  <span className="line-clamp-2">
                    {t.exercises.map((e) => e.title).join(", ") || "—"}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground hidden text-sm sm:table-cell">
                  {t.mine ? "Me" : t.owner}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={t.exercises.length === 0 || t.hidden > 0}
                    title={
                      t.hidden > 0
                        ? "Uses exercises that aren't shared with you"
                        : t.exercises.length === 0
                          ? "Add exercises first"
                          : "Assign to a class or group"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      setTarget({
                        id: t.id,
                        title: t.title,
                        mode: t.mode,
                        durationMinutes: t.durationMinutes,
                        exerciseCount: t.exercises.length,
                      });
                    }}
                  >
                    <CalendarPlus /> Assign
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <UseTemplateDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        template={target}
      />
    </>
  );
}
