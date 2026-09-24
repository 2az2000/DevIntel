-- AlterTable
ALTER TABLE "integrations" ADD COLUMN     "provider_metadata" JSONB NOT NULL DEFAULT '{}';

