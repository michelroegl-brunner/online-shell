import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { canSeeFiles, listDir, normalizeRel, readFile } from "~/server/files";

/**
 * Home file browser: my own files, or (teachers) a student of one of my
 * classes. See src/server/files.ts.
 */

const target = z.object({
  /** Whose files; default: mine. */
  userId: z.string().max(40).optional(),
  /** Relative to /home/student. */
  path: z.string().max(1000).default(""),
});

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    console.error("[files] runner call failed", e);
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The shell could not be reached right now. Try again shortly.",
    });
  }
}

export const filesRouter = createTRPCRouter({
  /** Whose files these are (for the page title). */
  owner: protectedProcedure
    .input(z.object({ userId: z.string().max(40).optional() }))
    .query(async ({ ctx, input }) => {
      const ownerId = input.userId ?? ctx.user.id;
      if (!(await canSeeFiles(ctx.db, ctx.user, ownerId))) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const u = await ctx.db.user.findUnique({
        where: { id: ownerId },
        select: { id: true, name: true, email: true },
      });
      if (!u) throw new TRPCError({ code: "NOT_FOUND" });
      return { ...u, self: u.id === ctx.user.id };
    }),

  list: protectedProcedure.input(target).query(async ({ ctx, input }) => {
    const ownerId = input.userId ?? ctx.user.id;
    if (!(await canSeeFiles(ctx.db, ctx.user, ownerId))) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    const rel = normalizeRel(input.path);
    return guard(() => listDir(ownerId, rel));
  }),

  read: protectedProcedure.input(target).query(async ({ ctx, input }) => {
    const ownerId = input.userId ?? ctx.user.id;
    if (!(await canSeeFiles(ctx.db, ctx.user, ownerId))) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    const rel = normalizeRel(input.path);
    if (!rel) throw new TRPCError({ code: "BAD_REQUEST" });
    return guard(() => readFile(ownerId, rel));
  }),
});
