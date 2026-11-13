-- Internet access: setups that download files, steps that need the internet.
ALTER TABLE "Exercise" ADD COLUMN "setupInternet" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ExerciseStep" ADD COLUMN "allowInternet" BOOLEAN NOT NULL DEFAULT false;
