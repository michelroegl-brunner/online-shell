import { assignmentRouter } from "~/server/api/routers/assignment";
import { boxRouter } from "~/server/api/routers/box";
import { cheatsheetRouter } from "~/server/api/routers/cheatsheet";
import { classRouter } from "~/server/api/routers/class";
import { exerciseRouter } from "~/server/api/routers/exercise";
import { explainRouter } from "~/server/api/routers/explain";
import { filesRouter } from "~/server/api/routers/files";
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
  files: filesRouter,
  cheatsheet: cheatsheetRouter,
  explain: explainRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
