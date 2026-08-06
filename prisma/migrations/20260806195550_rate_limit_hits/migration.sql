-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_limit_hits_windowStartedAt_idx" ON "rate_limit_hits"("windowStartedAt");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_hits_subject_action_key" ON "rate_limit_hits"("subject", "action");
