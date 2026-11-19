"use client";

import { CalendarPlus, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
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
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { api } from "~/trpc/react";
import { Chip, Field, GroupChips } from "../assignment-editor";
import { fromLocalInput, toLocalInput } from "../format";

export type UseTemplateTarget = {
  id: string;
  title: string;
  mode: "PRACTICE" | "EXAM";
  durationMinutes: number | null;
  exerciseCount: number;
};

type Publish = "now" | "onOpen" | "draft";

/** Picks class/groups and the window, then creates the assignment. */
export function UseTemplateDialog({
  open,
  onOpenChange,
  template,
  defaultClassId = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: UseTemplateTarget | null;
  defaultClassId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {/* Content unmounts when closed, so every opening starts fresh. */}
        {template && (
          <UseTemplateForm
            template={template}
            defaultClassId={defaultClassId}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function UseTemplateForm({
  template,
  defaultClassId,
  onDone,
}: {
  template: UseTemplateTarget;
  defaultClassId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const classes = api.assignment.classes.useQuery();
  const use = api.template.use.useMutation();

  const [title, setTitle] = useState(template.title);
  const [classId, setClassId] = useState(defaultClassId);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [opensAt, setOpensAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  /** Due follows opens + duration until edited by hand. */
  const [dueAuto, setDueAuto] = useState(true);
  const [publish, setPublish] = useState<Publish>("onOpen");

  const cls = classes.data?.find((c) => c.id === classId);
  const duration = template.durationMinutes;

  function changeOpens(v: string) {
    setOpensAt(v);
    const d = fromLocalInput(v);
    if (dueAuto && duration && d) {
      setDueAt(toLocalInput(new Date(d.getTime() + duration * 60_000)));
    }
  }

  async function submit() {
    if (!title.trim()) return toast.error("Please enter a title.");
    if (!classId) return toast.error("Please choose a class.");
    const o = fromLocalInput(opensAt);
    const d = fromLocalInput(dueAt);
    if (o && d && d <= o) {
      return toast.error("The due date must be after the opening date.");
    }
    if (publish === "onOpen" && !o) {
      return toast.error(
        "Set an opening time, or choose “publish now” / “draft”.",
      );
    }
    try {
      const res = await use.mutateAsync({
        id: template.id,
        title,
        classId,
        groupIds,
        opensAt: o,
        dueAt: d,
        published: publish === "now",
        publishAt: publish === "onOpen" ? o : null,
      });
      await utils.assignment.invalidate();
      onDone();
      toast.success(`Assigned to ${cls?.name ?? "class"}`, {
        action: {
          label: "Open",
          onClick: () => router.push(`/admin/assignments/${res.id}`),
        },
      });
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Assign template</DialogTitle>
        <DialogDescription>
          {template.exerciseCount ?? 0} exercise
          {template.exerciseCount === 1 ? "" : "s"}
          {template.mode === "EXAM" && (
            <Badge variant="destructive" className="ml-2 text-xs">
              exam
            </Badge>
          )}
          {duration ? ` · ${duration} min` : ""}. Times are local time.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Class" className="sm:col-span-2">
          <Select
            value={classId}
            onValueChange={(v) => {
              setClassId(v);
              setGroupIds([]);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a class" />
            </SelectTrigger>
            <SelectContent>
              {classes.data?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {cls && (
          <Field label="For" className="sm:col-span-2">
            <GroupChips
              groups={cls.groups}
              value={groupIds}
              onChange={setGroupIds}
            />
          </Field>
        )}
        <Field label="Opens">
          <Input
            type="datetime-local"
            value={opensAt}
            onChange={(e) => changeOpens(e.target.value)}
          />
        </Field>
        <Field label="Due">
          <Input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => {
              setDueAt(e.target.value);
              setDueAuto(false);
            }}
          />
        </Field>
        <Field label="Students see it" className="sm:col-span-2">
          <div className="flex flex-wrap gap-2">
            <Chip
              active={publish === "onOpen"}
              onClick={() => setPublish("onOpen")}
            >
              When it opens
            </Chip>
            <Chip active={publish === "now"} onClick={() => setPublish("now")}>
              Right away
            </Chip>
            <Chip
              active={publish === "draft"}
              onClick={() => setPublish("draft")}
            >
              Not yet (draft)
            </Chip>
          </div>
        </Field>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={use.isPending}>
          {use.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <CalendarPlus />
          )}
          Assign
        </Button>
      </DialogFooter>
    </>
  );
}
