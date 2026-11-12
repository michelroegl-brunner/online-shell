"use client";

import { Download, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";

/**
 * Import / export exercises as JSON bundles
 * ({ format: "online-shell-exercises", version: 1, exercises: [...] }).
 */
export function ImportExport() {
  const utils = api.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const importBundle = api.exercise.importBundle.useMutation();

  async function runImport(bundle: unknown, overwrite: boolean) {
    try {
      const r = await importBundle.mutateAsync({ bundle, overwrite });
      await utils.exercise.invalidate();
      const parts = [
        r.created.length && `${r.created.length} created`,
        r.updated.length && `${r.updated.length} updated`,
      ].filter(Boolean);
      const existing = r.skipped.filter((s) => s.reason === "already exists");
      const foreign = r.skipped.filter((s) => s.reason !== "already exists");
      if (parts.length) toast.success(`Import: ${parts.join(", ")}`);
      if (foreign.length) {
        toast.warning(
          `Skipped (belong to another teacher): ${foreign.map((s) => s.slug).join(", ")}`,
        );
      }
      if (existing.length) {
        toast.info(
          `${existing.length} already exist: ${existing.map((s) => s.slug).join(", ")}`,
          {
            duration: 15000,
            action: {
              label: "Overwrite",
              onClick: () => void runImport(bundle, true),
            },
          },
        );
      }
      if (!parts.length && !r.skipped.length) toast.info("Nothing to import.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onFile(file: File) {
    let bundle: unknown;
    try {
      bundle = JSON.parse(await file.text());
    } catch {
      toast.error("That file is not valid JSON.");
      return;
    }
    await runImport(bundle, false);
  }

  async function runExport() {
    setExporting(true);
    try {
      const bundle = await utils.exercise.exportBundle.fetch({});
      if (bundle.exercises.length === 0) {
        toast.info("You have no exercises to export.");
        return;
      }
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `exercises-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onFile(f);
        }}
      />
      <Button
        variant="ghost"
        onClick={() => fileRef.current?.click()}
        disabled={importBundle.isPending}
        title="Import exercises from a JSON file"
      >
        {importBundle.isPending ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Upload />
        )}
        Import
      </Button>
      <Button
        variant="ghost"
        onClick={() => void runExport()}
        disabled={exporting}
        title="Download all your exercises as a JSON file"
      >
        {exporting ? <Loader2 className="animate-spin" /> : <Download />}
        Export
      </Button>
    </>
  );
}
