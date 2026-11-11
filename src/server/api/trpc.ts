import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { isStaff } from "~/lib/roles";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

/** Context available in every procedure: DB + session. */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const session = await auth();
  return { db, session, ...opts };
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
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { session: { ...ctx.session, user: ctx.session.user } },
  });
});

/** TEACHER or ADMIN. */
export const teacherProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isStaff(ctx.session.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next();
});

/** ADMIN only. */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.session.user.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next();
});
