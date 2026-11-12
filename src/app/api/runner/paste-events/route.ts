import { timingSafeEqual } from "node:crypto";

import { env } from "~/env";
import {
  pasteBatchSchema,
  recordPasteBatch,
} from "~/server/assignments/paste-events";

/**
 * Runner → web: blocked paste attempts of one terminal (batched by the
 * runner). Internal only: bearer RUNNER_SECRET, and the public Caddy does
 * not forward /api/runner/*.
 */
export async function POST(req: Request) {
  const given = Buffer.from(
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""),
  );
  const expected = Buffer.from(env.RUNNER_SECRET);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = pasteBatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const attemptId = await recordPasteBatch(parsed.data);
  return Response.json({ ok: true, attemptId });
}
