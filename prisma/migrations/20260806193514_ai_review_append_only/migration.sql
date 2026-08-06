-- DropIndex
DROP INDEX "ai_reviews_submissionId_key";

-- AlterTable
ALTER TABLE "ai_reviews" ADD COLUMN     "injectionReported" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ai_reviews_submissionId_createdAt_idx" ON "ai_reviews"("submissionId", "createdAt");
