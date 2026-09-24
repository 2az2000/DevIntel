-- Indexes Prisma cannot express.
--
-- 1. Partial index on open pull requests. The open-PR count sits on the
--    dashboard's hot path and open PRs are a few percent of the table, so a
--    partial index keeps that query off the full relation.
--    See docs/01-data-model.md §5.3.
CREATE INDEX IF NOT EXISTS "pull_requests_open_idx"
  ON "pull_requests" ("workspace_id", "repository_id")
  WHERE "state" = 'OPEN';

-- 2. Partial index on pending raw events. The normalize stage polls only
--    PENDING rows; processed rows accumulate until retention prunes them.
CREATE INDEX IF NOT EXISTS "raw_events_pending_idx"
  ON "raw_events" ("received_at")
  WHERE "status" = 'PENDING';

-- 3. Partial index on active insights, which is what the insight feed reads.
CREATE INDEX IF NOT EXISTS "insights_active_idx"
  ON "insights" ("workspace_id", "severity", "detected_at" DESC)
  WHERE "status" = 'ACTIVE';

-- 4. Merged pull requests carry every delivery metric; the median queries
--    always filter on state and order by merge time.
CREATE INDEX IF NOT EXISTS "pull_requests_merged_idx"
  ON "pull_requests" ("workspace_id", "repository_id", "merged_at")
  WHERE "state" = 'MERGED';
