"use client";

import { CalendarPlus, Copy, Loader2, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { api } from "~/trpc/react";
import {
  Chip,
  type EditorItem,
  Field,
  ModeField,
  type Rules,
  RuleFields,
} from "../assignment-editor";
import { ExerciseSelection } from "../exercise-selection";
import { UseTemplateDialog } from "./use-template-dialog";

export type TemplateInitial = Rules & {
  title: string;
  description: string;
  /** "" = no suggested length */
  durationMinutes: string;
  visibility: "PRIVATE" | "SHARED";
  items: EditorItem[];
};

export function TemplateEditor({
  id,
  initial,
  readOnly = false,
  owner,
  hidden = 0,
}: {
  /** Undefined = new template. */
  id?: string;
  initial: TemplateInitial;
  /** Shared template of another teacher: can be used and copied only. */
  readOnly?: boolean;
  owner?: string;
  /** Exercises in it that the viewer can't read (private to the owner). */
  hidden?: number;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [useOpen, setUseOpen] = useState(false);
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(saved),
    [form, saved],
  );
  const patch = (p: Partial<TemplateInitial>) =>
    setForm((f) => ({ ...f, ...p }));

  const create = api.template.create.useMutation();
  const update = api.template.update.useMutation();
  const del = api.template.delete.useMutation();
  const duplicate = api.template.duplicate.useMutation();
  const saving = create.isPending || update.isPending;

  async function save() {
    if (!form.title.trim()) return toast.error("Please enter a title.");
    const maxChecks = form.maxChecks.trim();
    const duration = form.durationMinutes.trim();
    if (maxChecks !== "" && !(Number(maxChecks) >= 1)) {
      return toast.error("Max checks must be a positive number (or empty).");
    }
    if (duration !== "" && !(Number(duration) >= 1)) {
      return toast.error("Duration must be a positive number (or empty).");
    }
    const input = {
      title: form.title,
      description: form.description,
      mode: form.mode,
      maxChecks: maxChecks === "" ? null : Number(maxChecks),
      allowHints: form.allowHints,
      hintPenalty: form.hintPenalty,
      allowCheatSheet: form.allowCheatSheet,
      allowPaste: form.allowPaste,
      durationMinutes: duration === "" ? null : Math.round(Number(duration)),
      visibility: form.visibility,
      items: form.items.map((i) => ({
        exerciseId: i.exerciseId,
        points: i.points === "" ? null : Number(i.points),
        gate: i.gate,
      })),
    };
    try {
      if (id) {
        await update.mutateAsync({ id, data: input });
        setSaved(form);
        await utils.template.invalidate();
        toast.success("Saved");
        router.refresh();
      } else {
        const res = await create.mutateAsync(input);
        await utils.template.invalidate();
        toast.success("Template created");
        router.push(`/admin/assignments/templates/${res.id}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove() {
    if (!id) return;
    if (!window.confirm("Delete this template? Assignments made from it stay."))
      return;
    try {
      await del.mutateAsync({ id });
      await utils.template.invalidate();
      toast.success("Template deleted");
      router.push("/admin/assignments/templates");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function copy() {
    if (!id) return;
    try {
      const res = await duplicate.mutateAsync({ id });
      await utils.template.invalidate();
      toast.success("Template copied");
      router.push(`/admin/assignments/templates/${res.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <Link
            href="/admin/assignments/templates"
            className="text-muted-foreground text-sm hover:underline"
          >
            Templates
          </Link>
          <h1 className="text-2xl font-semibold">
            {id ? form.title || "Untitled" : "New template"}
          </h1>
          {readOnly && owner && (
            <p className="text-muted-foreground text-sm">
              Shared by {owner}. Copy it to make changes.
            </p>
          )}
          {hidden > 0 && (
            <p className="text-destructive text-sm">
              {hidden} exercise{hidden === 1 ? " is" : "s are"} private to the
              owner, so you can&apos;t assign or copy this template.
            </p>
          )}
        </div>
        {id && (
          <>
            <Button
              variant="ghost"
              disabled={hidden > 0}
              onClick={() => void copy()}
            >
              <Copy /> {readOnly ? "Copy to my templates" : "Duplicate"}
            </Button>
            {!readOnly && (
              <Button variant="ghost" onClick={() => void remove()}>
                <Trash2 /> Delete
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={dirty || hidden > 0}
              title={dirty ? "Save your changes first" : undefined}
              onClick={() => setUseOpen(true)}
            >
              <CalendarPlus /> Assign to class
            </Button>
          </>
        )}
        {!readOnly && (
          <Button
            onClick={() => void save()}
            disabled={saving || (!!id && !dirty)}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {id ? (dirty ? "Save" : "Saved") : "Create"}
          </Button>
        )}
      </div>

      <fieldset disabled={readOnly} className="contents">
        <Card>
          <CardHeader>
            <CardTitle>Template</CardTitle>
            <CardDescription>
              Exercises and rules only. Class, groups and dates are picked when
              you assign it.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-6">
            <Field label="Title" className="md:col-span-4">
              <Input
                value={form.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="Linux basics: find & grep"
              />
            </Field>
            <Field label="Visibility" className="md:col-span-2">
              <div className="flex h-9 items-center gap-2">
                <Chip
                  active={form.visibility === "PRIVATE"}
                  onClick={() => !readOnly && patch({ visibility: "PRIVATE" })}
                >
                  Only me
                </Chip>
                <Chip
                  active={form.visibility === "SHARED"}
                  onClick={() => !readOnly && patch({ visibility: "SHARED" })}
                >
                  All teachers
                </Chip>
              </div>
            </Field>
            <Field label="Notes (teachers only)" className="md:col-span-6">
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="e.g. second half of the find/grep unit"
              />
            </Field>

            <ModeField
              value={form.mode}
              onChange={(p) => !readOnly && patch(p)}
            />

            <Field label="Duration (minutes)" className="md:col-span-2">
              <Input
                type="number"
                min={1}
                placeholder="none"
                value={form.durationMinutes}
                onChange={(e) => patch({ durationMinutes: e.target.value })}
              />
              <span className="text-muted-foreground text-xs">
                Optional: fills in “Due” from “Opens” when you assign it.
              </span>
            </Field>
            <RuleFields value={form} onChange={patch} />
          </CardContent>
        </Card>
      </fieldset>

      {readOnly ? (
        <Card>
          <CardHeader>
            <CardTitle>Exercises</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex list-decimal flex-col gap-1 pl-6 text-sm">
              {form.items.map((i) => (
                <li key={i.exerciseId}>
                  {i.title}{" "}
                  <span className="text-muted-foreground">
                    {i.kind === "LESSON"
                      ? "(lesson)"
                      : `(${i.points === "" ? i.defaultPoints : i.points} pts)`}
                    {i.gate && " · locks the rest until solved"}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : (
        <ExerciseSelection
          items={form.items}
          onChange={(items) => patch({ items })}
        />
      )}

      {id && (
        <UseTemplateDialog
          open={useOpen}
          onOpenChange={setUseOpen}
          template={{
            id,
            title: form.title,
            mode: form.mode,
            durationMinutes:
              form.durationMinutes === "" ? null : Number(form.durationMinutes),
            exerciseCount: form.items.length,
          }}
        />
      )}
    </div>
  );
}
