import "server-only";

import { SignJWT } from "jose";

import { env } from "~/env";

/** Client for the runner service (runner/). See runner/src/index.ts. */

export type ShellKind = "BASH" | "PWSH";

export type ExtrasStatus = {
  status: "idle" | "building" | "failed";
  packages: string[];
  /** Tail of the last build's output. */
  log: string;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  images: { shell: ShellKind; image: string; fresh: boolean }[];
};

const secret = new TextEncoder().encode(env.RUNNER_SECRET);

async function call<T>(method: string, path: string, body?: unknown) {
  const res = await fetch(`${env.RUNNER_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.RUNNER_SECRET}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `runner ${method} ${path} → ${res.status}: ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

export const runner = {
  /** Without `shell`, any running box is reused as it is. */
  ensureBox: (userId: string, shell?: ShellKind) =>
    call<{ box: string }>("POST", "/boxes", { userId, shell }),

  /** Raw response: a file's bytes, or a .tar.gz of a folder (x-oshell-kind). */
  download: (userId: string, path: string, signal?: AbortSignal) =>
    fetch(
      `${env.RUNNER_URL}/boxes/${encodeURIComponent(userId)}/download?path=${encodeURIComponent(path)}`,
      {
        headers: { authorization: `Bearer ${env.RUNNER_SECRET}` },
        cache: "no-store",
        signal,
      },
    ),

  exec: (
    userId: string,
    opts: {
      script: string;
      interpreter?: "bash" | "pwsh";
      user?: "root" | "student";
      timeoutMs?: number;
      workdir?: string;
      /** Run in a helper container with internet access (setup). */
      internet?: boolean;
      /** Image of that helper container. */
      shell?: ShellKind;
    },
  ) =>
    call<{
      exitCode: number;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }>("POST", `/boxes/${encodeURIComponent(userId)}/exec`, opts),

  /** Connect the box to the internet or take it offline again. */
  setInternet: (userId: string, online: boolean) =>
    call<{ online: boolean }>(
      "PUT",
      `/boxes/${encodeURIComponent(userId)}/internet`,
      { online },
    ),

  /** Executables + apt packages that new boxes of this shell get. */
  tools: (shell: ShellKind) =>
    call<{ image: string; binaries: string[]; packages: string[] }>(
      "GET",
      `/images/${shell}/tools`,
    ),

  /** Admin's extra apt packages and the image build status. */
  extras: () => call<ExtrasStatus>("GET", "/images/extras"),

  /** Save the extra package list; the runner rebuilds in the background. */
  setExtras: (packages: string[]) =>
    call<ExtrasStatus>("PUT", "/images/extras", { packages }),

  removeBox: (userId: string) =>
    call<{ ok: true }>("DELETE", `/boxes/${encodeURIComponent(userId)}`),

  /** Students with an open terminal right now (live view). */
  sessions: () =>
    call<{
      sessions: {
        userId: string;
        terminals: number;
        cwd: string | null;
        watchers: number;
        /** A teacher is typing in one of the student's terminals. */
        controlled: boolean;
        /** Newest last; streamed from the shell, not yet in CommandLog. */
        recent: {
          at: number;
          exitCode: number | null;
          cwd: string;
          command: string;
        }[];
        lastActivity: number | null;
      }[];
    }>("GET", "/sessions"),

  /**
   * Token for a teacher to watch a student's terminal (read-only). The
   * caller must have checked that the teacher may see this student.
   */
  async watchInfo(studentId: string, teacherName: string) {
    const token = await new SignJWT({ name: teacherName })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(studentId)
      .setIssuer("oshell-web")
      .setAudience("oshell-watch")
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(secret);
    return { url: `${env.RUNNER_PUBLIC_URL}/watch`, token };
  },

  /**
   * Short-lived token the browser presents when opening the terminal
   * WebSocket. Valid for 60 s; only used for the upgrade handshake.
   */
  async attachInfo(
    userId: string,
    shell: ShellKind,
    cwd?: string,
    paste: { allowed: boolean; blockFrom: Date | null } = {
      allowed: true,
      blockFrom: null,
    },
    /** Box online while this terminal is the newest (step with internet). */
    internet = false,
  ) {
    const token = await new SignJWT({
      shell,
      ...(internet ? { internet: true } : {}),
      ...(cwd ? { cwd } : {}),
      // paste:false → the runner rate-limits / drops paste-like input.
      ...(paste.allowed ? {} : { paste: false }),
      // epoch ms: switch to "no paste" at this time (assignment opens).
      ...(paste.allowed && paste.blockFrom
        ? { pasteBlockFrom: paste.blockFrom.getTime() }
        : {}),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuer("oshell-web")
      .setAudience("oshell-attach")
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(secret);
    return { url: `${env.RUNNER_PUBLIC_URL}/attach`, token };
  },
};
