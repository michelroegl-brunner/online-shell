-- Reusable assignment templates (exercises + settings, no class/dates).
CREATE TABLE "AssignmentTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "mode" "AssignmentMode" NOT NULL DEFAULT 'PRACTICE',
    "maxChecks" INTEGER,
    "allowHints" BOOLEAN NOT NULL DEFAULT true,
    "hintPenalty" INTEGER NOT NULL DEFAULT 0,
    "allowCheatSheet" BOOLEAN NOT NULL DEFAULT true,
    "allowPaste" BOOLEAN NOT NULL DEFAULT false,
    "durationMinutes" INTEGER,
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssignmentTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "points" INTEGER,
    "gate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AssignmentTemplateItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssignmentTemplate_ownerId_idx" ON "AssignmentTemplate"("ownerId");
CREATE INDEX "AssignmentTemplateItem_exerciseId_idx" ON "AssignmentTemplateItem"("exerciseId");
CREATE UNIQUE INDEX "AssignmentTemplateItem_templateId_exerciseId_key" ON "AssignmentTemplateItem"("templateId", "exerciseId");

ALTER TABLE "AssignmentTemplate" ADD CONSTRAINT "AssignmentTemplate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentTemplateItem" ADD CONSTRAINT "AssignmentTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AssignmentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentTemplateItem" ADD CONSTRAINT "AssignmentTemplateItem_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
