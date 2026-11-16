-- Session replay / heatmap event log, hint penalties, per-student exercise
-- variables, personal practice sets.
ALTER TABLE "Exercise" ADD COLUMN "variables" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "Assignment" ADD COLUMN "hintPenalty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Assignment" ADD COLUMN "practiceForId" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "practiceTag" TEXT;
CREATE INDEX "Assignment_practiceForId_idx" ON "Assignment"("practiceForId");
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_practiceForId_fkey" FOREIGN KEY ("practiceForId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Attempt" ADD COLUMN "vars" JSONB;

ALTER TABLE "AttemptStep" ADD COLUMN "hintsAtPass" INTEGER;

CREATE TABLE "AttemptEvent" (
    "id" BIGSERIAL NOT NULL,
    "attemptId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "stepId" TEXT,
    "ok" BOOLEAN,
    "detail" TEXT,

    CONSTRAINT "AttemptEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AttemptEvent_attemptId_at_idx" ON "AttemptEvent"("attemptId", "at");
CREATE INDEX "AttemptEvent_stepId_type_idx" ON "AttemptEvent"("stepId", "type");
ALTER TABLE "AttemptEvent" ADD CONSTRAINT "AttemptEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
