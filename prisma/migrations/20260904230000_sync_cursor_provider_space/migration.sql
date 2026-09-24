-- DropIndex
DROP INDEX "sync_cursors_integration_id_repository_id_resource_key";

-- AlterTable
ALTER TABLE "sync_cursors" ADD COLUMN     "repository_external_id" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "sync_cursors_integration_id_repository_external_id_resource_key" ON "sync_cursors"("integration_id", "repository_external_id", "resource");

