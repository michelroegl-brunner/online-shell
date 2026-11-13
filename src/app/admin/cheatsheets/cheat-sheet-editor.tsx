"use client";

import { Archive, ArchiveRestore, Loader2, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Markdown } from "~/components/markdown";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { slugify } from "~/lib/exercise";
import {
  cheatSheetInput,
  type CheatSheetInput,
} from "~/server/cheatsheets/schema";
import { api } from "~/trpc/react";
import { Field, ScriptHelp } from "../exercises/form-parts";

/** Form state: tags as text. */
type FormState = Omit<CheatSheetInput, "tags"> & { tags: string };

const toForm = (s: CheatSheetInput): FormState => ({
  ...s,
  tags: s.tags.join(", "),
});

const fromForm = (f: FormState): CheatSheetInput => ({
  ...f,
  tags: f.tags
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean),
});

export function CheatSheetEditor({
  id,
  initial,
  canEdit = true,
  archived = false,
  author,
}: {
  /** Undefined = new sheet. */
  id?: string;
  initial: CheatSheetInput;
  canEdit?: boolean;
  archived?: boolean;
  author?: string;
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

  const create = api.cheatsheet.create.useMutation();
  const update = api.cheatsheet.update.useMutation();
  const setArchived = api.cheatsheet.setArchived.useMutation({
    onSuccess: async (_d, v) => {
      toast.success(
        v.archived ? "Cheat sheet archived" : "Cheat sheet restored",
      );
      await utils.cheatsheet.invalidate();
      router.refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = api.cheatsheet.delete.useMutation({
    onSuccess: async () => {
      toast.success("Cheat sheet deleted");
      await utils.cheatsheet.invalidate();
      router.push("/admin/cheatsheets");
    },
    onError: (e) => toast.error(e.message),
  });
  const saving = create.isPending || update.isPending;

  async function save() {
    const parsed = cheatSheetInput.safeParse(fromForm(form));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(`${first?.path.join(".")}: ${first?.message}`);
      return;
    }
    try {
      if (id) {
        await update.mutateAsync({ id, data: parsed.data });
        setSaved(form);
        await utils.cheatsheet.invalidate();
        toast.success("Saved");
        return;
      }
      const res = await create.mutateAsync(parsed.data);
      await utils.cheatsheet.invalidate();
      toast.success("Cheat sheet created");
      router.push(`/admin/cheatsheets/${res.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const readOnly = !canEdit;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">
          {id ? form.title || "Untitled" : "New cheat sheet"}
        </h1>
        {readOnly && (
          <span className="text-muted-foreground text-sm">
            Shared by {author ?? "another teacher"} (read-only)
          </span>
        )}
        {id && canEdit && (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete "${form.title}" permanently? This can't be undone. (Archive hides it instead.)`,
                  )
                )
                  remove.mutate({ id });
              }}
              disabled={remove.isPending}
            >
              <Trash2 /> Delete
            </Button>
            <Button
              variant="ghost"
              onClick={() => setArchived.mutate({ id, archived: !archived })}
              disabled={setArchived.isPending}
            >
              {archived ? <ArchiveRestore /> : <Archive />}
              {archived ? "Restore" : "Archive"}
            </Button>
          </>
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
        <Field label="Slug" className="md:col-span-2">
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
              <SelectItem value="PWSH">PowerShell 7</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Order (lower first)" className="md:col-span-2">
          <Input
            type="number"
            step={1}
            value={form.order}
            onChange={(e) => set("order", Number(e.target.value))}
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
              <SelectItem value="PRIVATE">Private (my classes only)</SelectItem>
              <SelectItem value="SHARED">Shared (all classes)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Tags (comma-separated)" className="md:col-span-6">
          <Input
            value={form.tags}
            onChange={(e) => set("tags", e.target.value)}
            placeholder="funktionen, functions, parameter"
          />
          <ScriptHelp>
            Shown on exercises with the same shell that have <b>at least one</b>{" "}
            of these tags.
          </ScriptHelp>
        </Field>
      </fieldset>

      <div className="flex flex-col gap-2">
        <ScriptHelp>
          Markdown. Keep it short and scannable: <code>##</code> headings (the
          students&apos; search filters by them), tables and small code blocks.
        </ScriptHelp>
        <div className="grid gap-4 lg:grid-cols-2">
          <Textarea
            readOnly={readOnly}
            spellCheck={false}
            className="min-h-[32rem] font-mono text-sm"
            value={form.body}
            onChange={(e) => set("body", e.target.value)}
          />
          <div className="max-h-[40rem] overflow-y-auto rounded-lg border p-4">
            <p className="text-muted-foreground mb-2 text-xs tracking-wide uppercase">
              Preview
            </p>
            <Markdown>{form.body || "_Nothing yet._"}</Markdown>
          </div>
        </div>
      </div>
    </div>
  );
}
