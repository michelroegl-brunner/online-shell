import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const meRouter = createTRPCRouter({
  /** The signed-in user with the classes they belong to / teach. */
  get: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        memberships: {
          where: { class: { archived: false } },
          select: { class: { select: { id: true, name: true } } },
          orderBy: { class: { name: "asc" } },
        },
        teachingClasses: {
          where: { class: { archived: false } },
          select: { class: { select: { id: true, name: true } } },
          orderBy: { class: { name: "asc" } },
        },
      },
    });
  }),
});
