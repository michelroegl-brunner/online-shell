-- Chained exercises: an exercise has 1..n steps; each attempt tracks
-- progress per step. Existing exercises become 1-step exercises.

-- CreateTable
CREATE TABLE "ExerciseStep" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "checkScript" TEXT NOT NULL DEFAULT '',
    "hints" TEXT[],
    "points" INTEGER NOT NULL DEFAULT 10,
    "requiresPrevious" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExerciseStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptStep" (
    "attemptId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "score" INTEGER,
    "checks" INTEGER NOT NULL DEFAULT 0,
    "hintsUsed" INTEGER NOT NULL DEFAULT 0,
    "checkOutput" TEXT,
    "passedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttemptStep_pkey" PRIMARY KEY ("attemptId","stepId")
);

-- CreateIndex
CREATE INDEX "ExerciseStep_exerciseId_order_idx" ON "ExerciseStep"("exerciseId", "order");

-- CreateIndex
CREATE INDEX "AttemptStep_stepId_idx" ON "AttemptStep"("stepId");

-- AddForeignKey
ALTER TABLE "ExerciseStep" ADD CONSTRAINT "ExerciseStep_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptStep" ADD CONSTRAINT "AttemptStep_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptStep" ADD CONSTRAINT "AttemptStep_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "ExerciseStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: every existing exercise becomes step 1 ("Task") with its check,
-- hints and points; the exercise text stays as the intro.
INSERT INTO "ExerciseStep" ("id", "exerciseId", "order", "title", "description", "checkScript", "hints", "points", "requiresPrevious")
SELECT 'stp' || substr(md5(e."id"), 1, 22), e."id", 0, 'Task', '', e."checkScript", COALESCE(e."hints", '{}'), e."points", true
FROM "Exercise" e;

-- Data: existing attempts get their progress on that step.
INSERT INTO "AttemptStep" ("attemptId", "stepId", "status", "score", "checks", "hintsUsed", "checkOutput", "passedAt", "updatedAt")
SELECT a."id", 'stp' || substr(md5(i."exerciseId"), 1, 22), a."status",
       CASE WHEN a."status" = 'PASSED' THEN e."points" ELSE NULL END,
       a."checks", a."hintsUsed", a."checkOutput", a."finishedAt", a."updatedAt"
FROM "Attempt" a
JOIN "AssignmentItem" i ON i."id" = a."assignmentItemId"
JOIN "Exercise" e ON e."id" = i."exerciseId";

-- AlterTable (after the data was copied)
ALTER TABLE "Exercise" DROP COLUMN "checkScript",
DROP COLUMN "hints";