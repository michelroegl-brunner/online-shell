import { boxRouter } from "~/server/api/routers/box";
import { meRouter } from "~/server/api/routers/me";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
  me: meRouter,
  box: boxRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
