-- Human waitpoints: runs can pause in WAITING on a Trigger.dev token stored in "Waitpoint".
-- Forward: safe on live data; "Waitpoint" was unused before this migration, so it has no rows and
-- the new NOT NULL columns need no backfill.
-- Rollback: drop the new columns/indexes and recreate "Waitpoint_runId_idx". Postgres can't drop enum
-- values, so leave 'WAITING' in place (old code never writes it) after moving any WAITING rows to FAILED.

-- AlterEnum
ALTER TYPE "MessageStatus" ADD VALUE 'WAITING';

-- AlterEnum
ALTER TYPE "RunStatus" ADD VALUE 'WAITING';

-- DropIndex
DROP INDEX "Waitpoint_runId_idx";

-- AlterTable
ALTER TABLE "Waitpoint" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "idempotencyKey" TEXT NOT NULL,
ADD COLUMN     "payload" JSONB NOT NULL,
ADD COLUMN     "response" JSONB,
ALTER COLUMN "expiresAt" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Waitpoint_idempotencyKey_key" ON "Waitpoint"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Waitpoint_runId_status_idx" ON "Waitpoint"("runId", "status");

