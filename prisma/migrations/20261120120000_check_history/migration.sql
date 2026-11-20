-- Full check output on each CHECK/AUTOCHECK event (teacher check history).
ALTER TABLE "AttemptEvent" ADD COLUMN "output" TEXT;
