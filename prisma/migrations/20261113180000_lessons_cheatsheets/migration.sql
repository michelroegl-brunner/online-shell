-- Lessons (guided, ungraded exercises), gated assignment items, cheat sheets.
CREATE TYPE "ExerciseKind" AS ENUM ('EXERCISE', 'LESSON');

ALTER TABLE "Exercise" ADD COLUMN "kind" "ExerciseKind" NOT NULL DEFAULT 'EXERCISE';

ALTER TABLE "AssignmentItem" ADD COLUMN "gate" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Assignment" ADD COLUMN "allowCheatSheet" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "CheatSheet" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shell" "ShellKind" NOT NULL,
    "tags" TEXT[],
    "body" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "visibility" "Visibility" NOT NULL DEFAULT 'SHARED',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheatSheet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheatSheet_slug_key" ON "CheatSheet"("slug");
CREATE INDEX "CheatSheet_authorId_idx" ON "CheatSheet"("authorId");

ALTER TABLE "CheatSheet" ADD CONSTRAINT "CheatSheet_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
