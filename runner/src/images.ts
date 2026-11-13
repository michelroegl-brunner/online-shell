import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { config } from "./config.js";
import { docker, type ShellKind } from "./boxes.js";

/**
 * Box images and extra packages.
 *
 * The deploy builds the base images (oshell-bash, oshell-pwsh). Admins can
 * add apt packages in the web app; the runner then builds "extra" images on
 * top (FROM base + apt-get install). Boxes use the extra image while it was
 * built from the CURRENT base; after a deploy rebuilt the base, boxes fall
 * back to the base and the extras are rebuilt in the background.
 *
 * The package list lives in the extra image's label `oshell.packages`, so
 * it survives runner restarts without a database.
 */

const PKG_RE = /^[a-z0-9][a-z0-9+.-]{0,62}$/;
export const isPackageName = (p: string) => PKG_RE.test(p);
export const MAX_PACKAGES = 60;

const baseImage = (shell: ShellKind) =>
  shell === "PWSH" ? config.PWSH_IMAGE : config.BASH_IMAGE;
const extraImage = (shell: ShellKind) =>
  shell === "PWSH" ? config.PWSH_EXTRA_IMAGE : config.BASH_EXTRA_IMAGE;
const SHELLS: ShellKind[] = ["BASH", "PWSH"];

const isNotFound = (err: unknown) =>
  (err as { statusCode?: number }).statusCode === 404;

async function inspectImage(name: string) {
  try {
    return await docker.getImage(name).inspect();
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

// ── build state (in memory) ──

type BuildState = {
  status: "idle" | "building" | "failed";
  /** Packages of the running/last build. */
  packages: string[];
  log: string;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
};
const build: BuildState = {
  status: "idle",
  packages: [],
  log: "",
  startedAt: null,
  finishedAt: null,
  error: null,
};
let running: Promise<void> | null = null;
/** Requested while a build ran: build this list next. */
let queued: string[] | null = null;

const parsePackages = (label: string | undefined) =>
  (label ?? "").split(/\s+/).filter(isPackageName);

/** The wanted package list: last request, else what the images carry. */
async function wantedPackages(): Promise<string[]> {
  if (queued) return queued;
  if (build.status !== "idle" || build.startedAt) return build.packages;
  for (const shell of SHELLS) {
    const img = await inspectImage(extraImage(shell));
    if (img) return parsePackages(img.Config.Labels?.["oshell.packages"]);
  }
  return [];
}

/** Is this extra image up to date (current base, same packages)? */
async function extraFresh(shell: ShellKind, packages: string[]) {
  const [base, extra] = await Promise.all([
    inspectImage(baseImage(shell)),
    inspectImage(extraImage(shell)),
  ]);
  if (!base || !extra) return false;
  const labels = extra.Config.Labels ?? {};
  return (
    labels["oshell.base"] === base.Id &&
    (labels["oshell.packages"] ?? "") === packages.join(" ")
  );
}

/**
 * Image for a new box: the extra image if it is current, else the base
 * (and a rebuild is started in the background).
 */
export async function imageForBox(shell: ShellKind): Promise<string> {
  const packages = await wantedPackages();
  if (packages.length === 0) return baseImage(shell);
  if (await extraFresh(shell, packages)) return extraImage(shell);
  // Stale after a deploy: rebuild, use the base meanwhile. A failed build
  // is not retried on every box start; the admin starts it again.
  if (build.status !== "failed") {
    void ensureExtras().catch((e: unknown) =>
      console.error("[images] rebuild failed", e),
    );
  }
  return baseImage(shell);
}

/** Set the package list (empty = no extras) and (re)build. */
export function setPackages(packages: string[]) {
  queued = [...new Set(packages)].sort();
  return ensureExtras();
}

/** Build the extra images if they are missing or stale. Deduplicated. */
export function ensureExtras(): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      // Loop: a new list may arrive while building.
      for (;;) {
        const packages = await wantedPackages();
        queued = null;
        const stale: ShellKind[] = [];
        for (const shell of SHELLS) {
          if (packages.length === 0 || !(await extraFresh(shell, packages))) {
            stale.push(shell);
          }
        }
        if (packages.length === 0) {
          await removeExtras();
          Object.assign(build, {
            status: "idle",
            packages,
            log: "",
            error: null,
            finishedAt: Date.now(),
          });
        } else if (stale.length > 0) {
          await buildExtras(packages, stale);
        }
        if (!queued) break;
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

async function removeExtras() {
  for (const shell of SHELLS) {
    await docker
      .getImage(extraImage(shell))
      .remove()
      .catch(() => undefined); // missing, or a box still uses it
  }
}

const MAX_LOG = 64 * 1024;

async function buildExtras(packages: string[], shells: ShellKind[]) {
  Object.assign(build, {
    status: "building",
    packages,
    log: "",
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
  });
  const append = (s: string) => {
    build.log = (build.log + s).slice(-MAX_LOG);
  };
  try {
    for (const shell of shells) {
      const base = await inspectImage(baseImage(shell));
      if (!base) {
        append(`\n${baseImage(shell)} is missing, skipped.\n`);
        continue;
      }
      append(`\n=== ${extraImage(shell)} (FROM ${baseImage(shell)}) ===\n`);
      await buildOne(shell, base.Id, packages, append);
    }
    Object.assign(build, { status: "idle", finishedAt: Date.now() });
    console.log(`[images] extras built: ${packages.join(" ")}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    append(`\nERROR: ${msg}\n`);
    Object.assign(build, {
      status: "failed",
      error: msg,
      finishedAt: Date.now(),
    });
    console.error("[images] build failed", err);
  }
}

async function buildOne(
  shell: ShellKind,
  baseId: string,
  packages: string[],
  append: (s: string) => void,
) {
  // Package names are validated (PKG_RE), so they are safe in RUN.
  const dockerfile = [
    `FROM ${baseImage(shell)}`,
    "USER root",
    "RUN apt-get update \\",
    ` && apt-get install -y --no-install-recommends ${packages.join(" ")} \\`,
    " && rm -rf /var/lib/apt/lists/*",
    "USER student",
    'CMD ["sleep", "infinity"]',
    "",
  ].join("\n");
  const dir = await mkdtemp(join(tmpdir(), "oshell-extra-"));
  try {
    await writeFile(join(dir, "Dockerfile"), dockerfile);
    const stream = await docker.buildImage(
      { context: dir, src: ["Dockerfile"] },
      {
        t: extraImage(shell),
        labels: {
          "oshell.managed": "1",
          "oshell.base": baseId,
          "oshell.packages": packages.join(" "),
        },
        rm: true,
        forcerm: true,
      },
    );
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        (err: Error | null, out: { error?: string }[]) => {
          const failed = err?.message ?? out.find((o) => o.error)?.error;
          if (failed) reject(new Error(failed));
          else resolve();
        },
        (ev: { stream?: string; error?: string }) => {
          if (ev.stream) append(ev.stream);
          if (ev.error) append(ev.error + "\n");
        },
      );
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function extrasStatus() {
  const packages = await wantedPackages();
  const images = await Promise.all(
    SHELLS.map(async (shell) => ({
      shell,
      image: extraImage(shell),
      fresh: packages.length > 0 && (await extraFresh(shell, packages)),
    })),
  );
  return { ...build, packages, images };
}

// ── installed tools (for exercise authors) ──

type Tools = { image: string; binaries: string[]; packages: string[] };
const toolsCache = new Map<string, Tools>(); // by image id

const LIST_SCRIPT = [
  "for d in /usr/local/bin /usr/bin /bin /usr/sbin /sbin; do",
  '  [ -d "$d" ] && find "$d" -maxdepth 1 \\( -type f -o -type l \\) -perm -u+x -printf "%f\\n"',
  "done | sort -u",
  "echo ---",
  "dpkg-query -W -f '${Package}\\n' | sort -u",
].join("\n");

/** Executables and apt packages in the image new boxes of `shell` get. */
export async function toolsFor(shell: ShellKind): Promise<Tools> {
  const image = await imageForBox(shell);
  const id = (await docker.getImage(image).inspect()).Id;
  const hit = toolsCache.get(id);
  if (hit) return hit;

  const out = new PassThrough();
  let text = "";
  out.on("data", (c: Buffer) => (text += c.toString("utf8")));
  const [result, container] = (await docker.run(
    image,
    ["bash", "-c", LIST_SCRIPT],
    out,
    {
      User: "student",
      Tty: true,
      HostConfig: {
        NetworkMode: "none",
        ReadonlyRootfs: true,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        Memory: 128 * 1024 * 1024,
      },
      Labels: { "oshell.role": "tools" },
    },
  )) as [{ StatusCode: number }, { remove: () => Promise<unknown> }];
  await container.remove().catch(() => undefined);
  if (result.StatusCode !== 0) throw new Error("listing tools failed");

  const [bins = "", pkgs = ""] = text.replace(/\r/g, "").split("---\n");
  const lines = (s: string) => s.split("\n").filter(Boolean);
  const tools = { image, binaries: lines(bins), packages: lines(pkgs) };
  toolsCache.set(id, tools);
  return tools;
}
