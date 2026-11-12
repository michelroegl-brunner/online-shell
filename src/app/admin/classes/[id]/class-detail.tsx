"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Loader2,
  RefreshCw,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
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
import { GroupsCard } from "./groups-card";

const fmt = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function ClassDetail({ id }: { id: string }) {
  const utils = api.useUtils();
  const cls = api.class.byId.useQuery({ id }, { retry: false });
  const invalidate = () => utils.class.invalidate();
  const onError = (e: { message: string }) => toast.error(e.message);

  const sync = api.class.syncMembers.useMutation({
    onSuccess: async (r) => {
      await invalidate();
      toast.success(
        `Synced: ${r.students} students` +
          (r.createdUsers ? `, ${r.createdUsers} new accounts` : "") +
          (r.skipped
            ? `, ${r.skipped} skipped (${[
                r.noEmail && `${r.noEmail} without email`,
                r.emailTaken &&
                  `${r.emailTaken} email already used by another account`,
              ]
                .filter(Boolean)
                .join(", ")})`
            : ""),
      );
    },
    onError,
  });
  const update = api.class.update.useMutation({
    onSuccess: async () => {
      await invalidate();
      toast.success("Saved");
    },
    onError,
  });
  const setArchived = api.class.setArchived.useMutation({
    onSuccess: invalidate,
    onError,
  });
  const addTeacher = api.class.addTeacher.useMutation({
    onSuccess: async () => {
      await invalidate();
      setTeacherEmail("");
    },
    onError,
  });
  const removeTeacher = api.class.removeTeacher.useMutation({
    onSuccess: invalidate,
    onError,
  });
  const addDevStudent = api.class.addDevStudent.useMutation({
    onSuccess: async () => {
      await invalidate();
      setStudentEmail("");
    },
    onError,
  });
  const removeDevStudent = api.class.removeDevStudent.useMutation({
    onSuccess: invalidate,
    onError,
  });

  const [teacherEmail, setTeacherEmail] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [schoolYear, setSchoolYear] = useState<string | null>(null);

  if (cls.isLoading) {
    return <p className="text-muted-foreground">Loading…</p>;
  }
  if (cls.error || !cls.data) {
    return (
      <p className="text-muted-foreground">
        Class not found.{" "}
        <Link href="/admin/classes" className="text-primary underline">
          Back to classes
        </Link>
      </p>
    );
  }
  const c = cls.data;
  const yearValue = schoolYear ?? c.schoolYear ?? "";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin/classes"
          className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> Classes
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto flex items-center gap-2 text-2xl font-semibold">
            {c.name}
            {c.isDev && <Badge variant="outline">dev</Badge>}
            {c.archived && <Badge variant="secondary">archived</Badge>}
          </h1>
          {!c.isDev && (
            <Button
              variant="secondary"
              onClick={() => sync.mutate({ id })}
              disabled={sync.isPending}
            >
              {sync.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Sync members
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => setArchived.mutate({ id, archived: !c.archived })}
            disabled={setArchived.isPending}
          >
            {c.archived ? <ArchiveRestore /> : <Archive />}
            {c.archived ? "Restore" : "Archive"}
          </Button>
        </div>
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ id, schoolYear: yearValue || null });
          }}
        >
          <label htmlFor="year" className="text-muted-foreground text-sm">
            School year
          </label>
          <Input
            id="year"
            className="h-8 w-28"
            placeholder="2026/27"
            value={yearValue}
            onChange={(e) => setSchoolYear(e.target.value)}
          />
          {yearValue !== (c.schoolYear ?? "") && (
            <Button size="sm" type="submit" disabled={update.isPending}>
              Save
            </Button>
          )}
        </form>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Students ({c.memberships.length})</CardTitle>
            <CardDescription>
              {c.isDev
                ? "Dev class: add dev-login students by email."
                : "Taken from the M365 group. Students are also synced when they sign in."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {c.isDev && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (studentEmail)
                    addDevStudent.mutate({ id, email: studentEmail });
                }}
              >
                <Input
                  type="email"
                  placeholder="student@dev.local"
                  value={studentEmail}
                  onChange={(e) => setStudentEmail(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={addDevStudent.isPending || !studentEmail}
                >
                  <UserPlus /> Add
                </Button>
              </form>
            )}
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Email
                    </TableHead>
                    <TableHead>Last login</TableHead>
                    {c.isDev && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.memberships.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="text-muted-foreground py-6 text-center"
                      >
                        No students yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {c.memberships.map(({ user }) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell className="text-muted-foreground hidden sm:table-cell">
                        {user.email}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.lastLoginAt
                          ? fmt.format(user.lastLoginAt)
                          : "never"}
                      </TableCell>
                      {c.isDev && (
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove ${user.name}`}
                            onClick={() =>
                              removeDevStudent.mutate({ id, userId: user.id })
                            }
                          >
                            <X />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Teachers</CardTitle>
            <CardDescription>Teachers who see this class.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="divide-y">
              {c.teachers.map(({ user }) => (
                <li key={user.id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{user.name}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {user.email}
                    </p>
                  </div>
                  {c.teachers.length > 1 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${user.name}`}
                      onClick={() =>
                        removeTeacher.mutate({ id, userId: user.id })
                      }
                    >
                      <X />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (teacherEmail)
                  addTeacher.mutate({ id, email: teacherEmail });
              }}
            >
              <Input
                type="email"
                placeholder="teacher@school.at"
                value={teacherEmail}
                onChange={(e) => setTeacherEmail(e.target.value)}
              />
              <Button
                type="submit"
                variant="secondary"
                size="icon"
                aria-label="Add teacher"
                disabled={addTeacher.isPending || !teacherEmail}
              >
                <UserPlus />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <GroupsCard
        classId={id}
        students={c.memberships.map((m) => ({
          id: m.user.id,
          name: m.user.name,
        }))}
        groups={c.groups}
      />
    </div>
  );
}
