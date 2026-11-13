"use client";

import { AlertTriangle, CheckCircle2, Loader2, Package } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { InstalledTools } from "~/components/tools/installed-tools";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { MAX_PACKAGES, PACKAGE_RE, parsePackageList } from "~/lib/packages";
import { api } from "~/trpc/react";

const fmt = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString("de-AT") : "—";

/**
 * Admin → Tools: what the student boxes have, and extra Debian packages
 * the runner installs into the box images (apt-get, both shells).
 */
export function BoxTools({ canEdit }: { canEdit: boolean }) {
  const utils = api.useUtils();
  const params = useSearchParams();
  const extras = api.tools.extras.useQuery(undefined, {
    // Poll while a build runs.
    refetchInterval: (q) =>
      q.state.data?.status === "building" ? 3000 : false,
  });
  const save = api.tools.setExtras.useMutation();

  const [text, setText] = useState<string | null>(null);
  const saved = extras.data?.packages ?? [];
  // Start from the saved list (+ ?add=… from "Install a package…").
  if (text === null && extras.data) {
    const add = params.get("add")?.trim().toLowerCase();
    const list = [...extras.data.packages];
    if (canEdit && add && PACKAGE_RE.test(add) && !list.includes(add)) {
      list.push(add);
    }
    setText(list.join("\n"));
  }

  const wanted = useMemo(() => parsePackageList(text ?? ""), [text]);
  const invalid = wanted.filter((p) => !PACKAGE_RE.test(p));
  const changed = [...wanted].sort().join(" ") !== saved.join(" ");
  const status = extras.data?.status;
  const building = status === "building";

  // A finished build changes what's installed.
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "building" && status && status !== "building") {
      void utils.tools.installed.invalidate();
      if (status === "idle") toast.success("Box images rebuilt");
      else toast.error("Building the box images failed — see the log");
    }
    prevStatus.current = status;
  }, [status, utils]);

  async function onSave() {
    try {
      await save.mutateAsync({ packages: wanted });
      toast.success("Saved — the box images are being rebuilt");
      await utils.tools.extras.invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Tools</h1>
        <p className="text-muted-foreground text-sm">
          What the student shells have installed, and extra packages for them.
          Students can&apos;t <code className="font-mono">apt install</code>{" "}
          themselves (read-only system, no network).
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <InstalledTools shell="BASH" />
        <InstalledTools shell="PWSH" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="size-5" /> Extra packages
            {extras.data && (
              <StatusBadge
                status={extras.data.status}
                fresh={extras.data.images.every((i) => i.fresh)}
                empty={saved.length === 0}
              />
            )}
          </CardTitle>
          <CardDescription>
            Debian 12 package names (e.g.{" "}
            <code className="font-mono">git python3 htop</code>), one per line.
            Saving builds new box images on top of the standard ones (a few
            minutes, Bash and PowerShell). Students get them with their next
            box; an open terminal switches when it reconnects. After a deploy
            they are rebuilt automatically. Look names up on{" "}
            <a
              href="https://packages.debian.org/bookworm/"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              packages.debian.org
            </a>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {extras.error ? (
            <p className="text-destructive text-sm">{extras.error.message}</p>
          ) : (
            <>
              <Textarea
                value={text ?? ""}
                onChange={(e) => setText(e.target.value)}
                readOnly={!canEdit}
                spellCheck={false}
                className="min-h-40 font-mono text-sm"
                placeholder={canEdit ? "git\npython3\nhtop" : "No extras."}
              />
              {invalid.length > 0 && (
                <p className="text-destructive text-sm">
                  Not a package name: {invalid.join(", ")}
                </p>
              )}
              {wanted.length > MAX_PACKAGES && (
                <p className="text-destructive text-sm">
                  At most {MAX_PACKAGES} packages.
                </p>
              )}
              {canEdit ? (
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => void onSave()}
                    disabled={
                      !(changed || status === "failed") ||
                      invalid.length > 0 ||
                      wanted.length > MAX_PACKAGES ||
                      save.isPending ||
                      building
                    }
                  >
                    {(save.isPending || building) && (
                      <Loader2 className="animate-spin" />
                    )}
                    {status === "failed" && !changed
                      ? "Try again"
                      : "Save & rebuild images"}
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Only admins can change the packages.
                </p>
              )}
              {extras.data && (extras.data.log || status !== "idle") && (
                <details open={status !== "idle"}>
                  <summary className="text-muted-foreground cursor-pointer text-sm">
                    Build log (started {fmt(extras.data.startedAt)}, finished{" "}
                    {fmt(extras.data.finishedAt)})
                  </summary>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-black/40 p-3 font-mono text-xs whitespace-pre-wrap">
                    {extras.data.log.slice(-20_000) || "…"}
                  </pre>
                </details>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({
  status,
  fresh,
  empty,
}: {
  status: "idle" | "building" | "failed";
  fresh: boolean;
  empty: boolean;
}) {
  if (status === "building")
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="size-3 animate-spin" /> building
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="size-3" /> build failed
      </Badge>
    );
  if (empty) return null;
  return fresh ? (
    <Badge variant="outline" className="gap-1 text-emerald-400">
      <CheckCircle2 className="size-3" /> installed
    </Badge>
  ) : (
    <Badge variant="outline">not built yet</Badge>
  );
}
