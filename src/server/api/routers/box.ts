import { z } from "zod";

import { SLUG_RE } from "~/lib/exercise";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { exerciseDir } from "~/server/exercises/run";
import { runner } from "~/server/runner";

export const boxRouter = createTRPCRouter({
  /**
   * Credentials for opening the caller's own terminal. The runner creates
   * the box on attach if needed; the user id comes from the session, so a
   * student can only ever reach their own box. `exercise` (a slug) opens
   * the shell in ~/exercises/<slug>.
   */
  attach: protectedProcedure
    .input(
      z.object({
        shell: z.enum(["BASH", "PWSH"]).default("BASH"),
        exercise: z.string().regex(SLUG_RE).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      runner.attachInfo(
        ctx.user.id,
        input.shell,
        input.exercise ? exerciseDir(input.exercise) : undefined,
      ),
    ),
});
