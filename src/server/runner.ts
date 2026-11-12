import "server-only";

import { SignJWT } from "jose";

import { env } from "~/env";

/** Client for the runner service (runner/). See runner/src/index.ts. */

export type ShellKind = "BASH" | "PWSH";

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
  ensureBox: (userId: string, shell: ShellKind) =>
    call<{ box: string }>("POST", "/boxes", { userId, shell }),

  exec: (
    userId: string,
    opts: {
      script: string;
      interpreter?: "bash" | "pwsh";
      user?: "root" | "student";
      timeoutMs?: number;
      workdir?: string;
    },
  ) =>
    call<{
      exitCode: number;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }>("POST", `/boxes/${encodeURIComponent(userId)}/exec`, opts),

  removeBox: (userId: string) =>
    call<{ ok: true }>("DELETE", `/boxes/${encodeURIComponent(userId)}`),

  /**
   * Short-lived token the browser presents when opening the terminal
   * WebSocket. Valid for 60 s; only used for the upgrade handshake.
   */
  async attachInfo(userId: string, shell: ShellKind, cwd?: string) {
    const token = await new SignJWT(cwd ? { shell, cwd } : { shell })
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
