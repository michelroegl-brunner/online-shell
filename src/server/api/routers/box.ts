import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { SLUG_RE } from "~/lib/exercise";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { openExamsFor } from "~/server/assignments/exam";
import { pastePolicyFor } from "~/server/assignments/paste";
import { exerciseDir } from "~/server/exercises/run";
import { internetForItem } from "./learn";
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
        /** Assignment item: online while its current step allows it. */
        itemId: z.string().max(100).optional(),
        /** Teacher test run of an exercise with internet steps. */
        testInternet: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Exam running: only terminals in that exam's exercise folders (no
      // playground, no other assignments: it's all the same box).
      const exams = await openExamsFor(ctx.db, ctx.user);
      if (
        exams.length > 0 &&
        !(
          input.exercise && exams.some((e) => e.slugs.includes(input.exercise!))
        )
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `The exam "${exams[0]!.title}" is running — only its exercises are available.`,
        });
      }
      const paste = await pastePolicyFor(ctx.db, ctx.user);
      // The newest terminal decides the box's internet (runner, on attach).
      const internet = input.itemId
        ? await internetForItem(ctx.db, ctx.user, input.itemId, input.exercise)
        : Boolean(input.testInternet) && ctx.user.role !== "STUDENT";
      const info = await runner.attachInfo(
        ctx.user.id,
        input.shell,
        input.exercise ? exerciseDir(input.exercise) : undefined,
        paste,
        internet,
      );
      return {
        ...info,
        allowPaste: paste.allowed,
        pasteBlockFrom: paste.blockFrom,
        internet,
      };
    }),
});
