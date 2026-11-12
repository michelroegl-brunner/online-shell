"use client";

import { Check, CloudDownload, Loader2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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

export function ClassList() {
  const router = useRouter();
  const [archived, setArchived] = useState(false);
  const mode = api.class.mode.useQuery();
  const list = api.class.list.useQuery({ archived });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Classes</h1>
        <Button
          size="sm"
          variant={archived ? "secondary" : "ghost"}
          aria-pressed={archived}
          onClick={() => setArchived((v) => !v)}
        >
          Archived
        </Button>
        {mode.data?.graphEnabled && <ImportDialog />}
        {mode.data?.devFallback && <DevCreateDialog />}
      </div>

      {mode.data && !mode.data.graphEnabled && !mode.data.devFallback && (
        <p className="text-muted-foreground mb-4 text-sm">
          Microsoft Graph is not configured, so classes can’t be imported yet.
        </p>
      )}
      {mode.data?.devFallback && (
        <p className="text-muted-foreground mb-4 text-sm">
          Dev mode: Microsoft Graph isn’t configured, so you can create dev
          classes and add dev-login students by hand.
        </p>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead className="hidden sm:table-cell">
                School year
              </TableHead>
              <TableHead>Students</TableHead>
              <TableHead className="hidden md:table-cell">Teachers</TableHead>
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
                  {archived
                    ? "No archived classes."
                    : mode.data?.devFallback
                      ? "No classes yet. Create a dev class to get started."
                      : "No classes yet. Import an M365 group to get started."}
                </TableCell>
              </TableRow>
            )}
            {list.data?.map((c) => (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                onClick={() => router.push(`/admin/classes/${c.id}`)}
              >
                <TableCell className="font-medium">
                  <Link href={`/admin/classes/${c.id}`}>{c.name}</Link>
                  {c.entraGroupId.startsWith("dev:") && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      dev
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground hidden sm:table-cell">
                  {c.schoolYear ?? "–"}
                </TableCell>
                <TableCell>{c._count.memberships}</TableCell>
                <TableCell className="text-muted-foreground hidden md:table-cell">
                  {c.teachers.map((t) => t.user.name).join(", ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function ImportDialog() {
  const router = useRouter();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [schoolYear, setSchoolYear] = useState("");
  const debounced = useDebounced(q, 300);

  const groups = api.class.searchGroups.useQuery(
    { q: debounced },
    { enabled: open && debounced.length >= 2, retry: false },
  );
  const importGroup = api.class.import.useMutation({
    onSuccess: async (res) => {
      await utils.class.invalidate();
      toast.success(
        res.alreadyImported
          ? "Class already existed, you were added as a teacher"
          : `Class imported (${res.sync?.students ?? 0} students)`,
      );
      setOpen(false);
      router.push(`/admin/classes/${res.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <CloudDownload /> Import from M365
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import a class</DialogTitle>
          <DialogDescription>
            Search your Microsoft 365 groups. Members become the students of the
            class; you become its teacher.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
            <Input
              autoFocus
              placeholder="Group name, e.g. 3AHITN"
              className="pl-8"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Input
            className="w-28"
            placeholder="2026/27"
            aria-label="School year"
            value={schoolYear}
            onChange={(e) => setSchoolYear(e.target.value)}
          />
        </div>
        <div className="max-h-80 overflow-auto">
          {debounced.length < 2 && (
            <p className="text-muted-foreground py-4 text-center text-sm">
              Type at least 2 characters.
            </p>
          )}
          {groups.isFetching && (
            <p className="text-muted-foreground flex items-center justify-center gap-2 py-4 text-sm">
              <Loader2 className="size-4 animate-spin" /> Searching…
            </p>
          )}
          {groups.error && (
            <p className="text-destructive py-4 text-sm">
              {groups.error.message}
            </p>
          )}
          {groups.data?.length === 0 && (
            <p className="text-muted-foreground py-4 text-center text-sm">
              No groups found.
            </p>
          )}
          <ul className="divide-y">
            {groups.data?.map((g) => (
              <li key={g.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{g.displayName}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {g.mail ?? g.description ?? g.id}
                  </p>
                </div>
                {g.classId ? (
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/admin/classes/${g.classId}`}>
                      <Check /> Imported
                    </Link>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={importGroup.isPending}
                    onClick={() =>
                      importGroup.mutate({
                        groupId: g.id,
                        schoolYear: schoolYear || undefined,
                      })
                    }
                  >
                    {importGroup.isPending &&
                    importGroup.variables?.groupId === g.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <CloudDownload />
                    )}
                    Import
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

function DevCreateDialog() {
  const router = useRouter();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const create = api.class.createDev.useMutation({
    onSuccess: async ({ id }) => {
      await utils.class.invalidate();
      setOpen(false);
      router.push(`/admin/classes/${id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New dev class
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New dev class</DialogTitle>
          <DialogDescription>
            Only for local testing without Microsoft 365.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate({ name });
          }}
        >
          <Input
            autoFocus
            placeholder="e.g. 3AHITN"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            Create
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
