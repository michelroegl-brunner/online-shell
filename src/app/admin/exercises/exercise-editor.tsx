"use client";

import { Archive, ArchiveRestore, Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Markdown } from "~/components/markdown";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import { exerciseInput, type ExerciseInput, slugify } from "~/lib/exercise";
import { api } from "~/trpc/react";
import { TestRunPanel } from "./test-run-panel";

/** Form state: list fields are edited as text. */
type FormState = Omit<ExerciseInput, "tags" | "hints"> & {
  tags: string;
  hints: string;
};

const toForm = (e: ExerciseInput): FormState => ({
  ...e,
  tags: e.tags.join(", "),
  hints: e.hints.join("\n"),
});

const fromForm = (f: FormState): ExerciseInput => ({
  ...f,
  tags: f.tags
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean),
  hints: f.hints
    .split("\n")
    .map((h) => h.trim())
    .filter(Boolean),
});

export function ExerciseEditor({
  id,
  initial,
  canEdit = true,
  archived = false,
}: {
  /** Undefined = new exercise. */
  id?: string;
  initial: ExerciseInput;
  canEdit?: boolean;
  archived?: boolean;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [saved, setSaved] = useState<FormState>(() => toForm(initial));
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

  /** Validates and saves. Returns false if nothing was saved. */
  async function save(): Promise<boolean> {
    const parsed = exerciseInput.safeParse(fromForm(form));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(`${first?.path.join(".")}: ${first?.message}`);
      return false;
    }
    try {
      if (id) {
        await update.mutateAsync({ id, data: parsed.data });
        setSaved(form);
        await utils.exercise.invalidate();
        toast.success("Saved");
      } else {
        const res = await create.mutateAsync(parsed.data);
        await utils.exercise.invalidate();
        toast.success("Exercise created");
        router.push(`/admin/exercises/${res.id}`);
      }
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  }

  const readOnly = !canEdit;

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
              <SelectItem value="PWSH">
                PowerShell (image not built yet)
              </SelectItem>
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
        <Field label="Points" className="md:col-span-1">
          <Input
            type="number"
            min={0}
            value={form.points}
            onChange={(e) => set("points", Number(e.target.value))}
          />
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
        <Field label="Tags (comma-separated)" className="md:col-span-6">
          <Input
            value={form.tags}
            onChange={(e) => set("tags", e.target.value)}
            placeholder="find, pipes, loops"
          />
        </Field>
      </fieldset>

      <Tabs defaultValue="description">
        <TabsList>
          <TabsTrigger value="description">Description</TabsTrigger>
          <TabsTrigger value="setup">Setup script</TabsTrigger>
          <TabsTrigger value="check">Check script</TabsTrigger>
          <TabsTrigger value="hints">Hints</TabsTrigger>
        </TabsList>

        <TabsContent value="description" className="grid gap-4 lg:grid-cols-2">
          <Textarea
            readOnly={readOnly}
            className="min-h-72 font-mono text-sm"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Markdown: what the student has to do…"
          />
          <div className="rounded-lg border p-4">
            <p className="text-muted-foreground mb-2 text-xs tracking-wide uppercase">
              Preview
            </p>
            <Markdown>{form.description || "_Nothing yet._"}</Markdown>
          </div>
        </TabsContent>

        <TabsContent value="setup" className="flex flex-col gap-2">
          <ScriptHelp>
            Bash, runs as <b>root</b> with <code>set -e</code> in{" "}
            <code>$OSHELL_DIR</code> ={" "}
            <code>~/exercises/{form.slug || "<slug>"}</code>. The folder is
            wiped before every run and given to the student afterwards. No
            network.
          </ScriptHelp>
          <Script
            readOnly={readOnly}
            value={form.setupScript}
            onChange={(v) => set("setupScript", v)}
          />
        </TabsContent>

        <TabsContent value="check" className="flex flex-col gap-2">
          <ScriptHelp>
            Bash, runs as <b>root</b> in <code>$OSHELL_DIR</code> when the
            student clicks “Check”. <b>Exit 0 = passed.</b> Everything printed
            is shown to the student as feedback. 30 s timeout.
          </ScriptHelp>
          <Script
            readOnly={readOnly}
            value={form.checkScript}
            onChange={(v) => set("checkScript", v)}
          />
        </TabsContent>

        <TabsContent value="hints" className="flex flex-col gap-2">
          <ScriptHelp>
            One hint per line (Markdown). Students reveal them one by one; hints
            are off in exams.
          </ScriptHelp>
          <Textarea
            readOnly={readOnly}
            className="min-h-40 text-sm"
            value={form.hints}
            onChange={(e) => set("hints", e.target.value)}
          />
        </TabsContent>
      </Tabs>

      {id && (
        <TestRunPanel
          exerciseId={id}
          slug={saved.slug}
          shell={saved.shell}
          dirty={dirty}
          onSaveFirst={canEdit ? save : undefined}
        />
      )}
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ScriptHelp({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground text-sm [&_code]:font-mono [&_code]:text-xs">
      {children}
    </p>
  );
}

function Script({
  value,
  onChange,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
}) {
  return (
    <Textarea
      readOnly={readOnly}
      spellCheck={false}
      className="min-h-80 bg-black/40 font-mono text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // Tab inserts two spaces instead of leaving the field.
        if (e.key === "Tab" && !e.shiftKey && !readOnly) {
          e.preventDefault();
          const el = e.currentTarget;
          const { selectionStart: s, selectionEnd: end } = el;
          const next = value.slice(0, s) + "  " + value.slice(end);
          onChange(next);
          requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
        }
      }}
    />
  );
}
