-- Wechselplan integration: groups mirrored from Wechselplan, grade push log.
ALTER TABLE "ClassGroup" ADD COLUMN "wechselplanKey" TEXT;

CREATE UNIQUE INDEX "ClassGroup_classId_wechselplanKey_key" ON "ClassGroup"("classId", "wechselplanKey");

CREATE TABLE "GradePush" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "sent" INTEGER NOT NULL,
    "written" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradePush_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GradePush_assignmentId_createdAt_idx" ON "GradePush"("assignmentId", "createdAt");

ALTER TABLE "GradePush" ADD CONSTRAINT "GradePush_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GradePush" ADD CONSTRAINT "GradePush_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
