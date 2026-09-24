/*
  Warnings:

  - Added the required column `workspace_id` to the `sync_cursors` table without a default value. This is not possible if the table is not empty.
  - Added the required column `workspace_id` to the `team_members` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "sync_cursors" ADD COLUMN     "workspace_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "team_members" ADD COLUMN     "workspace_id" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "sync_cursors_workspace_id_idx" ON "sync_cursors"("workspace_id");

-- CreateIndex
CREATE INDEX "team_members_workspace_id_idx" ON "team_members"("workspace_id");

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
