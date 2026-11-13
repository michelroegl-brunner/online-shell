import { PassThrough, type Duplex } from "node:stream";

import Docker from "dockerode";

import { config } from "./config.js";
import { imageForBox } from "./images.js";

/**
 * A "box" is one container per student. Only one live box per student:
 * all exercises of that student run in it (the persistent home volume can't
 * be shared safely between two containers). The home volume outlives the box.
 */

export type ShellKind = "BASH" | "PWSH";

export const docker = new Docker(); // default socket / Windows named pipe

const USER_ID_RE = /^[a-z0-9]{8,40}$/; // cuid
const LABEL = "oshell.managed";

export const boxName = (userId: string) => `oshell-box-${userId}`;
export const volumeName = (userId: string) => `oshell-home-${userId}`;

export function assertUserId(userId: string) {
  if (!USER_ID_RE.test(userId)) throw new HttpError(400, "invalid userId");
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// bash: our rcfile sources ~/.bashrc first and the Online Shell hooks last.
// The start dir may not exist yet (no setup run) → fall back to ~ quietly.
// `cwd` is validated in auth.ts and passed as an argument, never interpolated.
const shellCmd = (shell: ShellKind, cwd: string) => [
  "bash",
  "-c",
  shell === "PWSH"
    ? // Profile ($PSHOME/profile.ps1) sets the prompt + command log.
      'cd -- "$1" 2>/dev/null; exec pwsh -NoLogo'
    : 'cd -- "$1" 2>/dev/null; exec bash --rcfile /etc/oshell/rc.sh -i',
  "oshell",
  cwd,
];

// ── activity tracking (in memory; rebuilt with a grace period on restart) ──

type BoxState = { lastActivity: number; attached: number };
const state = new Map<string, BoxState>();

const getState = (userId: string) => {
  let s = state.get(userId);
  if (!s) {
    s = { lastActivity: Date.now(), attached: 0 };
    state.set(userId, s);
  }
  return s;
};

export const touch = (userId: string) => {
  getState(userId).lastActivity = Date.now();
};

/** Last input (ms epoch) per known box, for the teacher's live view. */
export const lastActivityOf = (userId: string) =>
  state.get(userId)?.lastActivity ?? null;

// ── per-user lock so two requests can't create the same box twice ──

const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

const isNotFound = (err: unknown) =>
  (err as { statusCode?: number }).statusCode === 404;

// ── lifecycle ──

/**
 * Make sure the student's box is running with the right shell image.
 * Without `shell` any running box is reused as it is (file browser: never
 * swap the image under an open terminal); a new one gets the bash image.
 */
export function ensureBox(userId: string, wanted?: ShellKind): Promise<string> {
  assertUserId(userId);
  return withLock(userId, async () => {
    const name = boxName(userId);
    const shell = wanted ?? "BASH";
    const image = await imageForBox(shell);
    const imageId = (await docker.getImage(image).inspect()).Id;
    const existing = docker.getContainer(name);
    try {
      const info = await existing.inspect();
      // Reuse only if running, same shell and same image build; otherwise
      // replace it (the home volume survives).
      if (
        info.State.Running &&
        (wanted === undefined ||
          (info.Config.Labels["oshell.shell"] === shell &&
            info.Image === imageId))
      ) {
        touch(userId);
        return name;
      }
      await existing.remove({ force: true });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }

    await ensureVolume(userId);

    const container = await docker.createContainer(
      containerSpec(userId, image, {
        name,
        network: "none",
        labels: { "oshell.shell": shell },
      }),
    );
    await container.start();

    // /run is a fresh tmpfs: prepare the command-log location.
    await execIn(userId, {
      user: "root",
      cmd: [
        "sh",
        "-c",
        "mkdir -p /run/oshell && touch /run/oshell/cmd.log && chown -R student:student /run/oshell",
      ],
    });

    const s = getState(userId);
    s.lastActivity = Date.now();
    return name;
  });
}

/**
 * Container settings shared by boxes and setup helpers: read-only rootfs,
 * the student's home volume, dropped caps, resource limits.
 */
function containerSpec(
  userId: string,
  image: string,
  opts: { name: string; network: string; labels: Record<string, string> },
): Docker.ContainerCreateOptions {
  return {
    name: opts.name,
    Image: image,
    Hostname: "oshell",
    User: "student",
    WorkingDir: "/home/student",
    Cmd: ["sleep", "infinity"],
    Labels: {
      [LABEL]: "1",
      "oshell.user": userId,
      "oshell.created": String(Date.now()),
      ...opts.labels,
    },
    HostConfig: {
      NetworkMode: opts.network,
      Memory: config.BOX_MEMORY_MB * 1024 * 1024,
      MemorySwap: config.BOX_MEMORY_MB * 1024 * 1024,
      NanoCpus: Math.round(config.BOX_CPUS * 1e9),
      PidsLimit: config.BOX_PIDS,
      ReadonlyRootfs: true,
      Tmpfs: {
        "/tmp": "rw,nosuid,nodev,size=64m",
        "/run": "rw,nosuid,nodev,size=8m",
      },
      Mounts: [
        {
          Type: "volume",
          Source: volumeName(userId),
          Target: "/home/student",
        },
      ],
      CapDrop: ["ALL"],
      // Only for root setup/check scripts (docker exec -u root). The
      // student can't gain them: no setuid binaries + no-new-privileges.
      CapAdd: ["CHOWN", "DAC_OVERRIDE", "FOWNER"],
      SecurityOpt: ["no-new-privileges"],
      Init: true,
    },
  };
}

async function ensureVolume(userId: string) {
  try {
    await docker.getVolume(volumeName(userId)).inspect();
  } catch (err) {
    if (!isNotFound(err)) throw err;
    await docker.createVolume({
      Name: volumeName(userId),
      Labels: { [LABEL]: "1", "oshell.user": userId },
    });
  }
}

/** Stop and remove the box. The home volume is kept. */
export async function removeBox(userId: string) {
  assertUserId(userId);
  await withLock(userId, async () => {
    try {
      await docker.getContainer(boxName(userId)).remove({ force: true });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    state.delete(userId);
  });
}

// ── non-interactive exec (setup / check scripts) ──

export type ExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const MAX_OUTPUT = 64 * 1024;

type ExecOpts = {
  cmd: string[];
  user?: "root" | "student";
  timeoutMs?: number;
  workdir?: string;
};

export function execIn(userId: string, opts: ExecOpts): Promise<ExecResult> {
  assertUserId(userId);
  return execInContainer(boxName(userId), opts);
}

async function execInContainer(
  name: string,
  opts: ExecOpts,
): Promise<ExecResult> {
  const container = docker.getContainer(name);
  const exec = await container.exec({
    Cmd: opts.cmd,
    User: opts.user ?? "student",
    WorkingDir: opts.workdir ?? "/home/student",
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  const stream = await exec.start({ hijack: true, stdin: false });

  const out = new PassThrough();
  const err = new PassThrough();
  docker.modem.demuxStream(stream, out, err);

  const collect = (s: PassThrough) => {
    let buf = "";
    s.on("data", (c: Buffer) => {
      if (buf.length < MAX_OUTPUT) buf += c.toString("utf8");
    });
    return () => buf.slice(0, MAX_OUTPUT);
  };
  const stdout = collect(out);
  const stderr = collect(err);

  const timeoutMs = opts.timeoutMs ?? 30_000;
  const timedOut = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => {
      stream.destroy();
      resolve(true);
    }, timeoutMs);
    stream.on("end", () => {
      clearTimeout(t);
      resolve(false);
    });
    stream.on("error", () => {
      clearTimeout(t);
      resolve(false);
    });
  });

  const info = await exec.inspect();
  return {
    exitCode: timedOut ? 124 : (info.ExitCode ?? -1),
    stdout: stdout(),
    stderr: stderr(),
    timedOut,
  };
}

/**
 * Run a command and pipe its stdout into `sink` (no size cap here; the
 * command limits itself). Resolves with the exit code.
 */
export async function execStream(
  userId: string,
  opts: { cmd: string[]; user?: "root" | "student"; timeoutMs?: number },
  sink: NodeJS.WritableStream,
): Promise<number> {
  assertUserId(userId);
  const exec = await docker.getContainer(boxName(userId)).exec({
    Cmd: opts.cmd,
    User: opts.user ?? "student",
    WorkingDir: "/home/student",
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const err = new PassThrough();
  err.resume(); // stderr is dropped
  docker.modem.demuxStream(stream, sink, err);
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      stream.destroy();
      resolve();
    }, opts.timeoutMs ?? 120_000);
    const done = () => {
      clearTimeout(t);
      resolve();
    };
    stream.on("end", done);
    stream.on("close", done);
    stream.on("error", done);
  });
  const info = await exec.inspect();
  return info.ExitCode ?? -1;
}

// ── internet access ──
// Boxes start with no network. A step with "internet access" connects the
// box to INTERNET_NETWORK while the student works on it; leaving it
// disconnects again. Setups that need the internet run in a short-lived
// helper container on that network instead (runOnline), so the student's
// shell never gets it for a setup.

let internetReady: Promise<void> | null = null;

/** Create the internet bridge network once (no traffic between boxes). */
function ensureInternetNetwork(): Promise<void> {
  internetReady ??= (async () => {
    try {
      await docker.getNetwork(config.INTERNET_NETWORK).inspect();
    } catch (err) {
      if (!isNotFound(err)) throw err;
      await docker.createNetwork({
        Name: config.INTERNET_NETWORK,
        Driver: "bridge",
        Labels: { [LABEL]: "1" },
        Options: {
          "com.docker.network.bridge.name": config.INTERNET_BRIDGE,
          "com.docker.network.bridge.enable_icc": "false",
        },
      });
      console.log(`[internet] created network ${config.INTERNET_NETWORK}`);
    }
  })().catch((err: unknown) => {
    internetReady = null; // retry next time
    throw err;
  });
  return internetReady;
}

const networksOf = (info: Docker.ContainerInspectInfo) =>
  Object.keys(info.NetworkSettings.Networks ?? {});

/** Is the student's box on the internet network right now? */
export async function hasInternet(userId: string): Promise<boolean> {
  assertUserId(userId);
  try {
    const info = await docker.getContainer(boxName(userId)).inspect();
    return networksOf(info).includes(config.INTERNET_NETWORK);
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/**
 * Connect the box to the internet network or take it off again (back to
 * "none"). No box running → nothing to do: new boxes start offline.
 */
export function setInternet(userId: string, online: boolean): Promise<void> {
  assertUserId(userId);
  return withLock(userId, async () => {
    const name = boxName(userId);
    let info;
    try {
      info = await docker.getContainer(name).inspect();
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }
    if (!info.State.Running) return;
    const nets = networksOf(info);
    const isOnline = nets.includes(config.INTERNET_NETWORK);
    if (online === isOnline) return;
    if (online) {
      await ensureInternetNetwork();
      // A container can't be on "none" and a real network at once.
      if (nets.includes("none")) {
        await docker.getNetwork("none").disconnect({ Container: name });
      }
      await docker
        .getNetwork(config.INTERNET_NETWORK)
        .connect({ Container: name });
    } else {
      await docker
        .getNetwork(config.INTERNET_NETWORK)
        .disconnect({ Container: name, Force: true });
      await docker
        .getNetwork("none")
        .connect({ Container: name })
        .catch(() => undefined); // no network at all is offline too
    }
    console.log(`[internet] ${name} ${online ? "online" : "offline"}`);
  });
}

const helperName = (userId: string) => `oshell-setup-${userId}`;

/**
 * Run a command as in execIn, but in a throwaway container on the internet
 * network that mounts the same home volume (setup scripts that download
 * files). The student's box stays offline.
 */
export function runOnline(
  userId: string,
  shell: ShellKind,
  opts: ExecOpts,
): Promise<ExecResult> {
  assertUserId(userId);
  return withLock(`setup:${userId}`, async () => {
    await ensureVolume(userId);
    await ensureInternetNetwork();
    const name = helperName(userId);
    // Left over from a crash: remove it first.
    await docker
      .getContainer(name)
      .remove({ force: true })
      .catch((err: unknown) => {
        if (!isNotFound(err)) throw err;
      });
    const container = await docker.createContainer(
      containerSpec(userId, await imageForBox(shell), {
        name,
        network: config.INTERNET_NETWORK,
        labels: { "oshell.role": "setup" },
      }),
    );
    try {
      await container.start();
      return await execInContainer(name, opts);
    } finally {
      await container.remove({ force: true }).catch((e: unknown) => {
        console.error(`[internet] could not remove ${name}`, e);
      });
    }
  });
}

// ── interactive PTY ──

export type Pty = {
  stream: Duplex;
  resize: (cols: number, rows: number) => Promise<void>;
  release: () => void;
};

export async function openPty(
  userId: string,
  shell: ShellKind,
  cols: number,
  rows: number,
  cwd = "/home/student",
): Promise<Pty> {
  await ensureBox(userId, shell);
  const exec = await docker.getContainer(boxName(userId)).exec({
    Cmd: shellCmd(shell, cwd),
    User: "student",
    WorkingDir: "/home/student",
    Env: ["TERM=xterm-256color", "LANG=C.UTF-8"],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
  });
  const stream = await exec.start({ hijack: true, stdin: true, Tty: true });
  const resize = async (c: number, r: number) => {
    try {
      await exec.resize({ w: clamp(c, 10, 500), h: clamp(r, 5, 200) });
    } catch {
      /* exec may already be gone */
    }
  };
  await resize(cols, rows);

  const s = getState(userId);
  s.attached += 1;
  let released = false;
  return {
    stream,
    resize,
    release: () => {
      if (released) return;
      released = true;
      s.attached = Math.max(0, s.attached - 1);
      s.lastActivity = Date.now();
    },
  };
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(n) || lo));

// ── reaper: idle + max-lifetime cleanup ──

export async function reap() {
  const now = Date.now();
  const idleMs = config.IDLE_MINUTES * 60_000;
  const maxMs = config.MAX_LIFETIME_MINUTES * 60_000;
  const list = await docker.listContainers({
    all: true,
    filters: { label: [`${LABEL}=1`] },
  });
  for (const c of list) {
    const userId = c.Labels["oshell.user"];
    if (!userId) continue;
    const created = Number(c.Labels["oshell.created"] ?? 0);
    // Setup helpers remove themselves; this only catches leftovers.
    if (c.Labels["oshell.role"] === "setup") {
      if (now - created > 10 * 60_000) {
        console.log(`[reaper] removing leftover ${c.Names[0]}`);
        await docker
          .getContainer(c.Id)
          .remove({ force: true })
          .catch(() => undefined);
      }
      continue;
    }
    const s = getState(userId); // unknown box (runner restart) → grace period
    const idle = s.attached === 0 && now - s.lastActivity > idleMs;
    const tooOld = now - created > maxMs;
    const dead = c.State !== "running";
    if (idle || tooOld || dead) {
      console.log(
        `[reaper] removing ${c.Names[0]} (${dead ? "stopped" : idle ? "idle" : "max lifetime"})`,
      );
      await removeBox(userId).catch((e: unknown) =>
        console.error("[reaper] remove failed", e),
      );
    }
  }
}
