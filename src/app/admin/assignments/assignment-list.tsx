"use client";

import { Copy, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { api } from "~/trpc/react";
import { windowLabel } from "./format";

const ALL = "__all__";

export function AssignmentList() {
  const router = useRouter();
  const [classId, setClassId] = useState(ALL);
  const classes = api.assignment.classes.useQuery();
  const list = api.assignment.list.useQuery({
    classId: classId === ALL ? undefined : classId,
  });
  const duplicate = api.assignment.duplicate.useMutation({
    onSuccess: ({ id }) => {
      toast.success("Assignment duplicated (unpublished)");
      router.push(`/admin/assignments/${id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const newHref =
    classId === ALL
      ? "/admin/assignments/new"
      : `/admin/assignments/new?classId=${classId}`;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Assignments</h1>
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All classes</SelectItem>
            {classes.data?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button asChild>
          <Link href={newHref}>
            <Plus /> New assignment
          </Link>
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Class</TableHead>
              <TableHead className="hidden md:table-cell">Window</TableHead>
              <TableHead className="hidden sm:table-cell">Solved</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {list.data?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-muted-foreground py-8 text-center"
                >
                  No assignments yet.{" "}
                  <Link href={newHref} className="text-primary underline">
                    Create the first one
                  </Link>
                  .
                </TableCell>
              </TableRow>
            )}
            {list.data?.map((a) => (
              <TableRow
                key={a.id}
                className="cursor-pointer"
                onClick={() => router.push(`/admin/assignments/${a.id}`)}
              >
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    {a.title}
                    {a.published ? (
                      <Badge className="text-xs">published</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        draft
                      </Badge>
                    )}
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    {a.itemCount} exercise{a.itemCount === 1 ? "" : "s"}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{a.class.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {a.groups.length === 0 ? (
                      <span className="text-muted-foreground text-xs">
                        Whole class
                      </span>
                    ) : (
                      a.groups.map((g) => (
                        <Badge
                          key={g.id}
                          variant="secondary"
                          className="text-xs"
                        >
                          {g.name}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground hidden text-sm md:table-cell">
                  {windowLabel(a.opensAt, a.dueAt)}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <span className="font-mono text-sm">
                    {a.passed}/{a.total}
                  </span>
                  <div className="text-muted-foreground text-xs">
                    {a.students} student{a.students === 1 ? "" : "s"}
                  </div>
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
                      duplicate.mutate({ id: a.id });
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
