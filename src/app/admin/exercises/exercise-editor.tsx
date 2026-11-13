"use client";

import { Archive, ArchiveRestore, Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Markdown } from "~/components/markdown";
import { InstalledTools } from "~/components/tools/installed-tools";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import {
  exerciseInput,
  type ExerciseInput,
  slugify,
  totalPoints,
} from "~/lib/exercise";
import { api } from "~/trpc/react";
import { Field, Script, ScriptHelp } from "./form-parts";
import {
  fromStepForm,
  StepsEditor,
  toStepForm,
  type StepForm,
} from "./steps-editor";
import { TestRunPanel } from "./test-run-panel";

/** Form state: tags as text, steps with their own form shape. */
type FormState = Omit<ExerciseInput, "tags" | "steps"> & {
  tags: string;
  steps: StepForm[];
};

const toForm = (
  e: ExerciseInput,
  stepAttempts: Record<string, number> = {},
): FormState => ({
  ...e,
  tags: e.tags.join(", "),
  steps: e.steps.map((s) =>
    toStepForm(s, s.id ? (stepAttempts[s.id] ?? 0) : 0),
  ),
});

const fromForm = (f: FormState): ExerciseInput => ({
  ...f,
  tags: f.tags
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean),
  steps: f.steps.map(fromStepForm),
});

export function ExerciseEditor({
  id,
  initial,
  stepAttempts,
  canEdit = true,
  archived = false,
}: {
  /** Undefined = new exercise. */
  id?: string;
  initial: ExerciseInput;
  /** Saved step id → number of students with progress on it. */
  stepAttempts?: Record<string, number>;
  canEdit?: boolean;
  archived?: boolean;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const [form, setForm] = useState<FormState>(() =>
    toForm(initial, stepAttempts),
  );
  const [saved, setSaved] = useState<FormState>(() =>
    toForm(initial, stepAttempts),
  );
  const [slugTouched, setSlugTouched] = useState(Boolean(id));
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(saved),
    [form, saved],
  );

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const create = api.exercise.create.useMutation();
  const update = api.exercise.update.useMutation();
  const setArchived = api.exercise.setArchived.useMutation({
    onSuccess: async (_d, v) => {
      toast.success(v.archived ? "Exercise archived" : "Exercise restored");
      await utils.exercise.invalidate();
      router.refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const saving = create.isPending || update.isPending;

  /**
   * Validates and saves. Returns the saved step ids (in order), or false if
   * nothing was saved.
   */
  async function save(): Promise<string[] | false> {
    const parsed = exerciseInput.safeParse(fromForm(form));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(`${first?.path.join(".")}: ${first?.message}`);
      return false;
    }
    try {
      if (id) {
        const res = await update.mutateAsync({ id, data: parsed.data });
        // New steps now have ids: keep them so the next save updates them.
        const next: FormState = {
          ...form,
          steps: form.steps.map((s, i) => ({
            ...s,
            id: res.stepIds[i] ?? s.id,
          })),
        };
        setForm(next);
        setSaved(next);
        await utils.exercise.invalidate();
        toast.success("Saved");
        return res.stepIds;
      }
      const res = await create.mutateAsync(parsed.data);
      await utils.exercise.invalidate();
      toast.success("Exercise created");
      router.push(`/admin/exercises/${res.id}`);
      return [];
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  }

  const readOnly = !canEdit;
  const total = totalPoints(form.steps);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">
          {id ? form.title || "Untitled" : "New exercise"}
        </h1>
        {readOnly && (
          <span className="text-muted-foreground text-sm">
            Shared by another teacher (read-only, duplicate it to edit)
          </span>
        )}
        {id && canEdit && (
          <Button
            variant="ghost"
            onClick={() => setArchived.mutate({ id, archived: !archived })}
            disabled={setArchived.isPending}
          >
            {archived ? <ArchiveRestore /> : <Archive />}
            {archived ? "Restore" : "Archive"}
          </Button>
        )}
        {canEdit && (
          <Button
            onClick={() => void save()}
            disabled={saving || (!!id && !dirty)}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {id ? (dirty ? "Save" : "Saved") : "Create"}
          </Button>
        )}
      </div>

      <fieldset disabled={readOnly} className="grid gap-4 md:grid-cols-6">
        <Field label="Title" className="md:col-span-4">
          <Input
            value={form.title}
            onChange={(e) => {
              set("title", e.target.value);
              if (!slugTouched) set("slug", slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="Slug (folder ~/exercises/…)" className="md:col-span-2">
          <Input
            className="font-mono"
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true);
              set("slug", e.target.value);
            }}
          />
        </Field>
        <Field label="Kind" className="md:col-span-2">
          <Select
            value={form.kind}
            onValueChange={(v) => set("kind", v as FormState["kind"])}
            disabled={readOnly}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EXERCISE">Exercise (graded)</SelectItem>
              <SelectItem value="LESSON">Lesson (guided, no points)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Shell" className="md:col-span-2">
          <Select
            value={form.shell}
            onValueChange={(v) => set("shell", v as FormState["shell"])}
            disabled={readOnly}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BASH">Bash</SelectItem>
              <SelectItem value="PWSH">PowerShell 7</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Difficulty (1–5)" className="md:col-span-1">
          <Input
            type="number"
            min={1}
            max={5}
            value={form.difficulty}
            onChange={(e) => set("difficulty", Number(e.target.value))}
          />
        </Field>
        <Field label="Points (sum of steps)" className="md:col-span-1">
          <div
            className="flex h-9 items-center px-1 font-medium tabular-nums"
            title={
              form.kind === "LESSON"
                ? "Lessons are always worth 0 points in assignments."
                : undefined
            }
          >
            {form.kind === "LESSON" ? 0 : total}
          </div>
        </Field>
        <Field label="Visibility" className="md:col-span-2">
          <Select
            value={form.visibility}
            onValueChange={(v) =>
              set("visibility", v as FormState["visibility"])
            }
            disabled={readOnly}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PRIVATE">Private (only me)</SelectItem>
              <SelectItem value="SHARED">Shared with all teachers</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Tags (comma-separated)" className="md:col-span-4">
          <Input
            value={form.tags}
            onChange={(e) => set("tags", e.target.value)}
            placeholder="find, pipes, loops"
          />
        </Field>
        {form.kind === "LESSON" && (
          <p className="text-muted-foreground text-sm md:col-span-6">
            <b>Lesson:</b> a guided walkthrough. It is worth 0 points (step
            points are ignored) and doesn&apos;t count towards grades. Each step
            is checked automatically after the student runs a command, so make
            the checks pass on their own (“command used” or a file the check
            sources). Code blocks in step texts get an “Into the terminal”
            button.
          </p>
        )}
      </fieldset>

      <Tabs defaultValue="steps">
        <TabsList>
          <TabsTrigger value="intro">Intro</TabsTrigger>
          <TabsTrigger value="setup">Setup script</TabsTrigger>
          <TabsTrigger value="steps">
            Steps
            <Badge variant="secondary" className="ml-1">
              {form.steps.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="intro" className="flex flex-col gap-2">
          <ScriptHelp>
            Shown above the steps. Each step has its own task text.
          </ScriptHelp>
          <div className="grid gap-4 lg:grid-cols-2">
            <Textarea
              readOnly={readOnly}
              className="min-h-72 font-mono text-sm"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Markdown: what this exercise is about…"
            />
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground mb-2 text-xs tracking-wide uppercase">
                Preview
              </p>
              <Markdown>{form.description || "_Nothing yet._"}</Markdown>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="setup" className="flex flex-col gap-2">
          <ScriptHelp>
            Bash, runs <b>once for the whole exercise</b> (all steps share the
            folder) as <b>root</b> with <code>set -e</code> in{" "}
            <code>$OSHELL_DIR</code> ={" "}
            <code>~/exercises/{form.slug || "<slug>"}</code>. The folder is
            wiped before every run (also on “Reset”) and given to the student
            afterwards.{" "}
            {form.setupInternet ? (
              <>
                Runs in a helper container <b>with internet</b> (
                <code>wget</code> and <code>curl</code> are installed); the
                student&apos;s shell stays offline.
              </>
            ) : (
              "No network."
            )}
          </ScriptHelp>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary mt-0.5 size-4"
              checked={form.setupInternet}
              disabled={readOnly}
              onChange={(e) => set("setupInternet", e.target.checked)}
            />
            <span>
              Internet during setup
              <span className="text-muted-foreground block text-xs">
                For downloads, e.g.{" "}
                <code className="font-mono">
                  wget -q https://raw.githubusercontent.com/…/data.csv
                </code>
                . Slower to start (an extra container per setup and reset).
              </span>
            </span>
          </label>
          <Script
            readOnly={readOnly}
            value={form.setupScript}
            onChange={(v) => set("setupScript", v)}
          />
          <InstalledTools shell={form.shell} />
        </TabsContent>

        <TabsContent value="steps" className="flex flex-col gap-3">
          <details className="group">
            <summary className="text-muted-foreground cursor-pointer text-sm">
              Which commands are installed in the box?
            </summary>
            <InstalledTools shell={form.shell} className="mt-2" />
          </details>
          <StepsEditor
            steps={form.steps}
            onChange={(steps) => set("steps", steps)}
            readOnly={readOnly}
            slug={form.slug}
          />
        </TabsContent>
      </Tabs>

      {id && (
        <TestRunPanel
          exerciseId={id}
          slug={saved.slug}
          shell={saved.shell}
          internet={saved.steps.some((s) => s.allowInternet)}
          steps={saved.steps
            .filter((s): s is StepForm & { id: string } => Boolean(s.id))
            .map((s) => ({ id: s.id, title: s.title }))}
          dirty={dirty}
          onSaveFirst={canEdit ? save : undefined}
        />
      )}
    </div>
  );
}
