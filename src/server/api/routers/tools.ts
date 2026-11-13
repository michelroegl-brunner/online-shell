import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { MAX_PACKAGES, PACKAGE_RE } from "~/lib/packages";
import {
  adminProcedure,
  createTRPCRouter,
  teacherProcedure,
} from "~/server/api/trpc";
import { runner } from "~/server/runner";

/**
 * Tools in the student boxes: what's installed (for exercise authors) and
 * the admin's extra apt packages, which the runner bakes into the images.
 */

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error("[tools] runner call failed", e);
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The runner is not reachable right now.",
    });
  }
}

export const toolsRouter = createTRPCRouter({
  /** Executables and apt packages that new boxes of this shell get. */
  installed: teacherProcedure
    .input(z.object({ shell: z.enum(["BASH", "PWSH"]) }))
    .query(({ input }) => guard(() => runner.tools(input.shell))),

  /** Extra packages + build status (teachers see it, admins change it). */
  extras: teacherProcedure.query(() => guard(() => runner.extras())),

  setExtras: adminProcedure
    .input(
      z.object({
        packages: z
          .array(
            z
              .string()
              .regex(PACKAGE_RE, "Not a valid Debian package name")
              .max(63),
          )
          .max(MAX_PACKAGES),
      }),
    )
    .mutation(({ input }) =>
      guard(() => runner.setExtras([...new Set(input.packages)].sort())),
    ),
});
