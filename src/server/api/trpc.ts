import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { isStaff } from "~/lib/roles";
import { getCurrentUser } from "~/server/auth/current-user";
import { db } from "~/server/db";

/**
 * Context available in every procedure: DB + the signed-in user, loaded from
 * the DB (live role — the JWT is only trusted for identity).
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const user = await getCurrentUser();
  return { db, user, ...opts };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;

const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();
  const result = await next();
  if (t._config.isDev) {
    console.log(`[TRPC] ${path} took ${Date.now() - start}ms`);
  }
  return result;
});

export const publicProcedure = t.procedure.use(timingMiddleware);

/** Any signed-in user. */
export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { user: ctx.user } });
});

/** TEACHER or ADMIN. */
export const teacherProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isStaff(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next();
});

/** ADMIN only. */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next();
});
