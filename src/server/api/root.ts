import { assignmentRouter } from "~/server/api/routers/assignment";
import { boxRouter } from "~/server/api/routers/box";
import { classRouter } from "~/server/api/routers/class";
import { exerciseRouter } from "~/server/api/routers/exercise";
import { insightsRouter } from "~/server/api/routers/insights";
import { learnRouter } from "~/server/api/routers/learn";
import { manageRouter } from "~/server/api/routers/manage";
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
  manage: manageRouter,
  insights: insightsRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
