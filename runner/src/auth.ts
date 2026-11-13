import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { jwtVerify } from "jose";

import { config } from "./config.js";

const secretKey = new TextEncoder().encode(config.RUNNER_SECRET);

/** Web app → runner API calls carry `Authorization: Bearer <RUNNER_SECRET>`. */
export function isAuthorizedApiCall(req: IncomingMessage): boolean {
  const header = req.headers.authorization ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(config.RUNNER_SECRET);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type AttachClaims = {
  userId: string;
  shell: "BASH" | "PWSH";
  /** Optional start directory; must be inside /home/student. */
  cwd?: string;
  /** false = drop paste-like input (assignment forbids pasting). */
  allowPaste: boolean;
  /** epoch ms: from then on behave as if allowPaste were false. */
  pasteBlockFrom?: number;
};

/**
 * Teacher → runner watch WebSocket: 60 s HS256 JWT (`aud: "oshell-watch"`,
 * `sub` = the student). The web app checks that the teacher teaches the
 * student before minting it.
 */
export async function verifyWatchToken(
  token: string,
): Promise<{ userId: string; name: string }> {
  const { payload } = await jwtVerify(token, secretKey, {
    audience: "oshell-watch",
    issuer: "oshell-web",
    algorithms: ["HS256"],
  });
  if (typeof payload.sub !== "string") throw new Error("bad claims");
  // Shown to the student when this teacher asks to take over.
  const name =
    typeof payload.name === "string" ? payload.name.slice(0, 100) : "Teacher";
  return { userId: payload.sub, name };
}

const CWD_RE = /^\/home\/student(\/[A-Za-z0-9._-]+)*$/;

/**
 * Browser → runner WebSocket: short-lived HS256 JWT minted by the web app
 * (`aud: "oshell-attach"`, `sub: userId`, `shell`).
 */
export async function verifyAttachToken(token: string): Promise<AttachClaims> {
  const { payload } = await jwtVerify(token, secretKey, {
    audience: "oshell-attach",
    issuer: "oshell-web",
    algorithms: ["HS256"],
  });
  const shell = payload.shell;
  if (
    typeof payload.sub !== "string" ||
    (shell !== "BASH" && shell !== "PWSH")
  ) {
    throw new Error("bad claims");
  }
  const cwd = payload.cwd;
  if (
    cwd !== undefined &&
    (typeof cwd !== "string" || !CWD_RE.test(cwd) || cwd.includes(".."))
  ) {
    throw new Error("bad cwd");
  }
  return {
    userId: payload.sub,
    shell,
    cwd,
    allowPaste: payload.paste !== false,
    pasteBlockFrom:
      typeof payload.pasteBlockFrom === "number"
        ? payload.pasteBlockFrom
        : undefined,
  };
}
