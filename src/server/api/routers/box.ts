import { z } from "zod";

import { SLUG_RE } from "~/lib/exercise";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { pastePolicyFor } from "~/server/assignments/paste";
import { exerciseDir } from "~/server/exercises/run";
import { runner } from "~/server/runner";

export const boxRouter = createTRPCRouter({
  /**
   * Credentials for opening the caller's own terminal. The runner creates
   * the box on attach if needed; the user id comes from the session, so a
   * student can only ever reach their own box. `exercise` (a slug) opens
   * the shell in ~/exercises/<slug>. `allowPaste` is decided here (server)
   * and enforced by the runner; the terminal also blocks it in the browser.
   */
  attach: protectedProcedure
    .input(
      z.object({
        shell: z.enum(["BASH", "PWSH"]).default("BASH"),
        exercise: z.string().regex(SLUG_RE).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const paste = await pastePolicyFor(ctx.db, ctx.user);
      const info = await runner.attachInfo(
        ctx.user.id,
        input.shell,
        input.exercise ? exerciseDir(input.exercise) : undefined,
        paste,
      );
      return {
        ...info,
        allowPaste: paste.allowed,
        pasteBlockFrom: paste.blockFrom,
      };
    }),
});
