import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { runner } from "~/server/runner";

export const boxRouter = createTRPCRouter({
  /**
   * Credentials for opening the caller's own terminal. The runner creates
   * the box on attach if needed; the user id comes from the session, so a
   * student can only ever reach their own box.
   */
  attach: protectedProcedure
    .input(z.object({ shell: z.enum(["BASH", "PWSH"]).default("BASH") }))
    .mutation(({ ctx, input }) => runner.attachInfo(ctx.user.id, input.shell)),
});
