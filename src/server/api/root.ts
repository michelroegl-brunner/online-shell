import { assignmentRouter } from "~/server/api/routers/assignment";
import { boxRouter } from "~/server/api/routers/box";
import { classRouter } from "~/server/api/routers/class";
import { exerciseRouter } from "~/server/api/routers/exercise";
import { learnRouter } from "~/server/api/routers/learn";
import { meRouter } from "~/server/api/routers/me";
import { reportRouter } from "~/server/api/routers/report";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
  me: meRouter,
  box: boxRouter,
  exercise: exerciseRouter,
  class: classRouter,
  assignment: assignmentRouter,
  learn: learnRouter,
  report: reportRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
