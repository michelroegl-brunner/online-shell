-- Ready-made checks per step (file exists / content / command output / command used).
ALTER TABLE "ExerciseStep" ADD COLUMN "checks" JSONB NOT NULL DEFAULT '[]';
