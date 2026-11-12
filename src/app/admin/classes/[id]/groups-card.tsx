"use client";

import { Check, Pencil, Plus, Split, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { api } from "~/trpc/react";

type Student = { id: string; name: string };
type Group = { id: string; name: string; members: { userId: string }[] };

/**
 * Groups of a class (e.g. "Gruppe A" / "Gruppe B"). Assignments can later
 * target groups instead of the whole class.
 */
export function GroupsCard({
  classId,
  students,
  groups,
}: {
  classId: string;
  students: Student[];
  groups: Group[];
}) {
  const utils = api.useUtils();
  const invalidate = () => utils.class.byId.invalidate({ id: classId });
  const onError = (e: { message: string }) => toast.error(e.message);

  const [newName, setNewName] = useState("");
  const [splitCount, setSplitCount] = useState(2);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null,
  );

  const create = api.class.createGroup.useMutation({
    onSuccess: async () => {
      setNewName("");
      await invalidate();
    },
    onError,
  });
  const rename = api.class.renameGroup.useMutation({
    onSuccess: async () => {
      setEditing(null);
      await invalidate();
    },
    onError,
  });
  const remove = api.class.deleteGroup.useMutation({
    onSuccess: invalidate,
    onError,
  });
  const setMembers = api.class.setGroupMembers.useMutation({
    onSuccess: invalidate,
    onError,
  });
  const split = api.class.splitEvenly.useMutation({
    onSuccess: async (r) => {
      toast.success(`Split ${r.students} students into ${r.groups} groups`);
      await invalidate();
    },
    onError,
  });

  const nameOf = new Map(students.map((s) => [s.id, s.name]));
  const memberSets = new Map(
    groups.map((g) => [g.id, new Set(g.members.map((m) => m.userId))]),
  );
  const ungrouped = students.filter(
    (s) => !groups.some((g) => memberSets.get(g.id)?.has(s.id)),
  );

  function toggle(groupId: string, userId: string, on: boolean) {
    const current = memberSets.get(groupId) ?? new Set<string>();
    const next = new Set(current);
    if (on) next.add(userId);
    else next.delete(userId);
    setMembers.mutate({ groupId, userIds: [...next] });
  }

  function doSplit() {
    if (
      groups.length > 0 &&
      !window.confirm(
        `Replace the ${groups.length} existing group(s)? Assignments that target them lose that targeting.`,
      )
    ) {
      return;
    }
    split.mutate({ classId, count: splitCount, replace: groups.length > 0 });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Groups ({groups.length})</CardTitle>
        <CardDescription>
          Split the class, e.g. for lab lessons. Assignments can target one or
          more groups instead of the whole class. A student may be in several
          groups.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) create.mutate({ classId, name: newName });
            }}
          >
            <Input
              className="w-44"
              placeholder="New group name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={create.isPending || !newName.trim()}
            >
              <Plus /> Add group
            </Button>
          </form>
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="split" className="text-muted-foreground text-sm">
              Split into
            </label>
            <Input
              id="split"
              type="number"
              min={2}
              max={26}
              className="w-16"
              value={splitCount}
              onChange={(e) => setSplitCount(Number(e.target.value))}
            />
            <Button
              variant="secondary"
              onClick={doSplit}
              disabled={split.isPending || students.length === 0}
            >
              <Split /> Split evenly
            </Button>
          </div>
        </div>

        {groups.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <div key={g.id} className="rounded-lg border p-3">
                <div className="mb-2 flex items-center gap-1">
                  {editing?.id === g.id ? (
                    <form
                      className="flex flex-1 gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        rename.mutate({ groupId: g.id, name: editing.name });
                      }}
                    >
                      <Input
                        autoFocus
                        className="h-8"
                        value={editing.name}
                        onChange={(e) =>
                          setEditing({ id: g.id, name: e.target.value })
                        }
                      />
                      <Button size="icon" type="submit" aria-label="Save name">
                        <Check />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        type="button"
                        aria-label="Cancel"
                        onClick={() => setEditing(null)}
                      >
                        <X />
                      </Button>
                    </form>
                  ) : (
                    <>
                      <p className="mr-auto font-medium">
                        {g.name}{" "}
                        <span className="text-muted-foreground text-sm font-normal">
                          ({g.members.length})
                        </span>
                      </p>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Rename ${g.name}`}
                        onClick={() => setEditing({ id: g.id, name: g.name })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${g.name}`}
                        onClick={() => {
                          if (window.confirm(`Delete group "${g.name}"?`)) {
                            remove.mutate({ groupId: g.id });
                          }
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {g.members.length === 0 && (
                    <span className="text-muted-foreground text-xs">
                      No students
                    </span>
                  )}
                  {g.members
                    .map((m) => nameOf.get(m.userId) ?? "?")
                    .sort((a, b) => a.localeCompare(b))
                    .map((n) => (
                      <Badge
                        key={n}
                        variant="secondary"
                        className="font-normal"
                      >
                        {n}
                      </Badge>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {groups.length > 0 && students.length > 0 && (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  {groups.map((g) => (
                    <TableHead key={g.id} className="text-center">
                      {g.name}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    {groups.map((g) => {
                      const on = memberSets.get(g.id)?.has(s.id) ?? false;
                      return (
                        <TableCell key={g.id} className="text-center">
                          <input
                            type="checkbox"
                            className="accent-primary size-4 cursor-pointer"
                            aria-label={`${s.name} in ${g.name}`}
                            checked={on}
                            disabled={setMembers.isPending}
                            onChange={(e) =>
                              toggle(g.id, s.id, e.target.checked)
                            }
                          />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {groups.length > 0 && ungrouped.length > 0 && (
          <p className="text-muted-foreground text-sm">
            Not in any group: {ungrouped.map((s) => s.name).join(", ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
