-- DropIndex
DROP INDEX "Attempt_userId_idx";

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "resets" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "setupAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_userId_assignmentItemId_key" ON "Attempt"("userId", "assignmentItemId");