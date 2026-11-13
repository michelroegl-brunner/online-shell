import { TRPCError } from "@trpc/server";

import { getCurrentUser } from "~/server/auth/current-user";
import { db } from "~/server/db";
import { absPath, canSeeFiles, normalizeRel } from "~/server/files";
import { runner } from "~/server/runner";

/**
 * GET /api/files/download?path=…[&user=…] — a file from the home folder,
 * or a folder as .tar.gz. Same access rules as the `files` router.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const ownerId = url.searchParams.get("user") ?? user.id;
  let rel: string;
  try {
    rel = normalizeRel(url.searchParams.get("path") ?? "");
  } catch (e) {
    if (e instanceof TRPCError)
      return new Response("invalid path", { status: 400 });
    throw e;
  }
  if (!(await canSeeFiles(db, user, ownerId))) {
    return new Response("not found", { status: 404 });
  }

  let res: Response;
  try {
    await runner.ensureBox(ownerId);
    res = await runner.download(ownerId, absPath(rel), req.signal);
  } catch (e) {
    console.error("[files] download failed", e);
    return new Response("shell not reachable", { status: 502 });
  }
  if (!res.ok || !res.body) {
    return new Response(res.status === 404 ? "not found" : "download failed", {
      status: res.status === 404 ? 404 : 502,
    });
  }
  const dir = res.headers.get("x-oshell-kind") === "dir";
  const base = rel ? rel.slice(rel.lastIndexOf("/") + 1) : "home";
  const name = dir ? `${base}.tar.gz` : base;
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return new Response(res.body, {
    headers: {
      "content-type": dir ? "application/gzip" : "application/octet-stream",
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
