"use client";

import {
  ChevronRight,
  Download,
  File,
  FileSymlink,
  Folder,
  Home,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const fmtSize = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 ** 2).toFixed(1)} MB`;

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/**
 * Browse a home folder (/home/student): folders on the left, a text
 * preview of the selected file on the right, downloads for both (folders
 * as .tar.gz). `userId` = whose files (teachers); default: mine.
 */
export function FileBrowser({
  userId,
  initialPath = "",
}: {
  userId?: string;
  initialPath?: string;
}) {
  const [dir, setDir] = useState(initialPath.replace(/^\/+|\/+$/g, ""));
  const [file, setFile] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  const list = api.files.list.useQuery({ userId, path: dir }, { retry: false });
  const read = api.files.read.useQuery(
    { userId, path: file ?? "" },
    { enabled: file !== null, retry: false },
  );

  const dl = (path: string) =>
    `/api/files/download?${new URLSearchParams({
      path,
      ...(userId ? { user: userId } : {}),
    }).toString()}`;

  const crumbs = dir ? dir.split("/") : [];
  const entries = (list.data?.entries ?? []).filter(
    (e) => hidden || !e.name.startsWith("."),
  );
  const open = (d: string) => {
    setDir(d);
    setFile(null);
  };

  return (
    <div className="grid min-h-[28rem] gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="flex min-w-0 flex-col rounded-lg border">
        <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5 text-sm">
          <button
            type="button"
            onClick={() => open("")}
            className="hover:bg-accent flex items-center gap-1 rounded px-1.5 py-0.5"
          >
            <Home className="size-3.5" /> ~
          </button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
              <button
                type="button"
                onClick={() => open(crumbs.slice(0, i + 1).join("/"))}
                className="hover:bg-accent truncate rounded px-1.5 py-0.5"
              >
                {c}
              </button>
            </span>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <label className="text-muted-foreground flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                className="accent-primary"
                checked={hidden}
                onChange={(e) => setHidden(e.target.checked)}
              />
              hidden
            </label>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh"
              title="Refresh"
              onClick={() => void list.refetch()}
            >
              <RefreshCw className={cn(list.isFetching && "animate-spin")} />
            </Button>
            <Button
              asChild
              variant="ghost"
              size="icon"
              title="Download folder (.tar.gz)"
            >
              <a href={dl(dir)} aria-label="Download this folder">
                <Download />
              </a>
            </Button>
          </div>
        </div>
        <ul className="flex-1 overflow-auto py-1 text-sm">
          {list.isLoading && (
            <li className="text-muted-foreground px-3 py-2">Loading…</li>
          )}
          {list.error && (
            <li className="text-destructive px-3 py-2">{list.error.message}</li>
          )}
          {list.data && entries.length === 0 && (
            <li className="text-muted-foreground px-3 py-2">Empty folder.</li>
          )}
          {entries.map((e) => {
            const path = join(dir, e.name);
            const Icon =
              e.type === "d" ? Folder : e.type === "l" ? FileSymlink : File;
            return (
              <li key={e.name}>
                <button
                  type="button"
                  onClick={() => (e.type === "d" ? open(path) : setFile(path))}
                  className={cn(
                    "hover:bg-accent/50 flex w-full items-center gap-2 px-3 py-1 text-left",
                    file === path && "bg-accent",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      e.type === "d" ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                    {e.name}
                  </span>
                  {e.type !== "d" && (
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {fmtSize(e.size)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {list.data?.truncated && (
            <li className="text-muted-foreground px-3 py-2 text-xs">
              Only the first 1000 entries are shown.
            </li>
          )}
        </ul>
      </div>

      <div className="flex min-w-0 flex-col rounded-lg border">
        {file === null ? (
          <p className="text-muted-foreground m-auto p-6 text-sm">
            Select a file to see its content.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-sm">
                ~/{file}
              </span>
              {read.data && (
                <span className="text-muted-foreground text-xs">
                  {fmtSize(read.data.size)}
                </span>
              )}
              <Button asChild size="sm" variant="secondary">
                <a href={dl(file)}>
                  <Download /> Download
                </a>
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {read.isLoading && (
                <p className="text-muted-foreground p-3 text-sm">Loading…</p>
              )}
              {read.error && (
                <p className="text-destructive p-3 text-sm">
                  {read.error.message}
                </p>
              )}
              {read.data?.text === null && (
                <p className="text-muted-foreground p-3 text-sm">
                  Binary file — download it to open it.
                </p>
              )}
              {read.data?.text != null && (
                <>
                  <pre className="p-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap">
                    {read.data.text || (
                      <span className="text-muted-foreground">
                        (empty file)
                      </span>
                    )}
                  </pre>
                  {read.data.truncated && (
                    <p className="text-muted-foreground border-t px-3 py-2 text-xs">
                      Only the beginning is shown — download the file for all of
                      it.
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
