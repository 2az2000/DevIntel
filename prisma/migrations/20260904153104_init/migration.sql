-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('GITHUB', 'GITLAB', 'BITBUCKET', 'SEED', 'GIT');

-- CreateEnum
CREATE TYPE "IdentityKind" AS ENUM ('PROVIDER_USER', 'EMAIL');

-- CreateEnum
CREATE TYPE "IdentityConfidence" AS ENUM ('EXACT', 'INFERRED', 'MANUAL');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'TOKEN_EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncResource" AS ENUM ('REPOSITORIES', 'COMMITS', 'PULL_REQUESTS', 'REVIEWS', 'ISSUES');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('IDLE', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncKind" AS ENUM ('INITIAL', 'INCREMENTAL', 'BACKFILL', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "RawEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PullRequestState" AS ENUM ('OPEN', 'MERGED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "IssueState" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('DEVELOPER', 'REPOSITORY', 'TEAM', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "Granularity" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "ScoreKey" AS ENUM ('DEVELOPER_HEALTH', 'REPOSITORY_HEALTH', 'TEAM_HEALTH');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('POSITIVE', 'INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "InsightStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('DEVELOPER', 'REPOSITORY', 'TEAM', 'ORGANIZATION', 'MONTHLY_ENGINEERING');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('WEB', 'PDF', 'CSV', 'JSON');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MetricKey" AS ENUM ('commits', 'lines_changed', 'prs_opened', 'prs_merged', 'prs_open_end', 'pr_merge_rate', 'pr_cycle_time_median', 'pr_time_to_first_review_median', 'pr_size_median', 'pr_review_rounds_median', 'pr_reopen_rate', 'reviews_given', 'reviews_received', 'review_response_time_median', 'review_depth_median', 'review_coverage', 'review_reciprocity', 'reviewer_diversity', 'review_load_gini', 'distinct_collaborators', 'active_days_ratio', 'activity_cv', 'repositories_active', 'contribution_recency', 'active_contributors', 'commit_frequency', 'days_since_last_push', 'stale_pr_ratio', 'open_pr_age_median', 'issues_opened', 'issues_closed', 'issue_close_rate', 'issue_resolution_time_median', 'stale_issue_ratio', 'bus_factor', 'knowledge_concentration');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "name" TEXT,
    "avatar_url" TEXT,
    "email_verified_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_oauth_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'refresh',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "rotated_from_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "retention_days" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "week_starts_on" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "developer_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "primary_email" TEXT,
    "avatar_url" TEXT,
    "claimed_by_user_id" TEXT,
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "merged_into_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "developers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_identities" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "developer_id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "kind" "IdentityKind" NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" "IdentityConfidence" NOT NULL DEFAULT 'EXACT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "developer_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "account_login" TEXT NOT NULL,
    "access_token_enc" BYTEA,
    "refresh_token_enc" BYTEA,
    "token_expires_at" TIMESTAMP(3),
    "scopes" TEXT[],
    "webhook_secret_enc" BYTEA,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_cursors" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "repository_id" TEXT,
    "resource" "SyncResource" NOT NULL,
    "cursor" TEXT,
    "since" TIMESTAMP(3),
    "status" "SyncStatus" NOT NULL DEFAULT 'IDLE',
    "last_synced_at" TIMESTAMP(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "kind" "SyncKind" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_events" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "event_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "delivery_id" TEXT,
    "payload" JSONB NOT NULL,
    "status" "RawEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "raw_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "is_fork" BOOLEAN NOT NULL DEFAULT false,
    "primary_language" TEXT,
    "languages" JSONB NOT NULL DEFAULT '{}',
    "stars" INTEGER NOT NULL DEFAULT 0,
    "forks" INTEGER NOT NULL DEFAULT 0,
    "open_issues_count" INTEGER NOT NULL DEFAULT 0,
    "created_at_remote" TIMESTAMP(3),
    "pushed_at_remote" TIMESTAMP(3),
    "sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "tracked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commits" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "author_developer_id" TEXT,
    "committer_developer_id" TEXT,
    "authored_at" TIMESTAMP(3) NOT NULL,
    "committed_at" TIMESTAMP(3) NOT NULL,
    "message" TEXT NOT NULL,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "changed_files" INTEGER NOT NULL DEFAULT 0,
    "parent_count" INTEGER NOT NULL DEFAULT 1,
    "is_merge" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "commits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pull_requests" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "state" "PullRequestState" NOT NULL,
    "is_draft" BOOLEAN NOT NULL DEFAULT false,
    "author_developer_id" TEXT,
    "merged_by_developer_id" TEXT,
    "base_branch" TEXT NOT NULL,
    "head_branch" TEXT NOT NULL,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "changed_files" INTEGER NOT NULL DEFAULT 0,
    "commit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at_remote" TIMESTAMP(3) NOT NULL,
    "updated_at_remote" TIMESTAMP(3),
    "ready_for_review_at" TIMESTAMP(3),
    "first_review_at" TIMESTAMP(3),
    "first_approval_at" TIMESTAMP(3),
    "merged_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "review_rounds" INTEGER NOT NULL DEFAULT 0,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "time_to_first_review_minutes" INTEGER,
    "review_duration_minutes" INTEGER,
    "cycle_time_minutes" INTEGER,

    CONSTRAINT "pull_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pull_request_reviews" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "pull_request_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "reviewer_developer_id" TEXT,
    "state" "ReviewState" NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "response_time_minutes" INTEGER,

    CONSTRAINT "pull_request_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "state" "IssueState" NOT NULL,
    "author_developer_id" TEXT,
    "assignee_developer_id" TEXT,
    "labels" TEXT[],
    "created_at_remote" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "resolution_time_minutes" INTEGER,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repository_contributors" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "developer_id" TEXT NOT NULL,
    "commits" INTEGER NOT NULL DEFAULT 0,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "prs_authored" INTEGER NOT NULL DEFAULT 0,
    "prs_merged" INTEGER NOT NULL DEFAULT 0,
    "reviews_given" INTEGER NOT NULL DEFAULT 0,
    "contribution_share" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "first_contribution_at" TIMESTAMP(3),
    "last_contribution_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_contributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_snapshots" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "subject_type" "SubjectType" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "metric_key" "MetricKey" NOT NULL,
    "granularity" "Granularity" NOT NULL,
    "period_start" DATE NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "sample_size" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_snapshots" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "subject_type" "SubjectType" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "score_key" "ScoreKey" NOT NULL,
    "granularity" "Granularity" NOT NULL,
    "period_start" DATE NOT NULL,
    "value" DECIMAL(6,2) NOT NULL,
    "coverage" DECIMAL(4,3) NOT NULL DEFAULT 1,
    "components" JSONB NOT NULL,
    "version" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_daily_rollups" (
    "workspace_id" TEXT NOT NULL,
    "developer_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "commits" INTEGER NOT NULL DEFAULT 0,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "prs_opened" INTEGER NOT NULL DEFAULT 0,
    "prs_merged" INTEGER NOT NULL DEFAULT 0,
    "prs_closed" INTEGER NOT NULL DEFAULT 0,
    "reviews_given" INTEGER NOT NULL DEFAULT 0,
    "reviews_received" INTEGER NOT NULL DEFAULT 0,
    "issues_closed" INTEGER NOT NULL DEFAULT 0,
    "active_repositories" INTEGER NOT NULL DEFAULT 0,
    "median_time_to_first_review_minutes" INTEGER,
    "median_cycle_time_minutes" INTEGER,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "developer_daily_rollups_pkey" PRIMARY KEY ("workspace_id","developer_id","day")
);

-- CreateTable
CREATE TABLE "repository_daily_rollups" (
    "workspace_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "commits" INTEGER NOT NULL DEFAULT 0,
    "active_contributors" INTEGER NOT NULL DEFAULT 0,
    "prs_opened" INTEGER NOT NULL DEFAULT 0,
    "prs_merged" INTEGER NOT NULL DEFAULT 0,
    "prs_closed" INTEGER NOT NULL DEFAULT 0,
    "open_prs_at_end" INTEGER NOT NULL DEFAULT 0,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "issues_opened" INTEGER NOT NULL DEFAULT 0,
    "issues_closed" INTEGER NOT NULL DEFAULT 0,
    "open_issues_at_end" INTEGER NOT NULL DEFAULT 0,
    "median_time_to_first_review_minutes" INTEGER,
    "median_cycle_time_minutes" INTEGER,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repository_daily_rollups_pkey" PRIMARY KEY ("workspace_id","repository_id","day")
);

-- CreateTable
CREATE TABLE "team_daily_rollups" (
    "workspace_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "active_developers" INTEGER NOT NULL DEFAULT 0,
    "commits" INTEGER NOT NULL DEFAULT 0,
    "prs_opened" INTEGER NOT NULL DEFAULT 0,
    "prs_merged" INTEGER NOT NULL DEFAULT 0,
    "reviews_given" INTEGER NOT NULL DEFAULT 0,
    "open_prs_at_end" INTEGER NOT NULL DEFAULT 0,
    "median_time_to_first_review_minutes" INTEGER,
    "median_cycle_time_minutes" INTEGER,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_daily_rollups_pkey" PRIMARY KEY ("workspace_id","team_id","day")
);

-- CreateTable
CREATE TABLE "insights" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "subject_type" "SubjectType" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "metric_key" "MetricKey",
    "change_percent" DECIMAL(10,4),
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "InsightStatus" NOT NULL DEFAULT 'ACTIVE',
    "dedupe_key" TEXT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "insight_id" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" "ReportStatus" NOT NULL DEFAULT 'QUEUED',
    "storage_key" TEXT,
    "requested_by_user_id" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "user_oauth_accounts_user_id_idx" ON "user_oauth_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_oauth_accounts_provider_provider_user_id_key" ON "user_oauth_accounts"("provider", "provider_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "workspaces_owner_user_id_idx" ON "workspaces"("owner_user_id");

-- CreateIndex
CREATE INDEX "workspace_members_workspace_id_idx" ON "workspace_members"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "teams_workspace_id_idx" ON "teams"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_workspace_id_slug_key" ON "teams"("workspace_id", "slug");

-- CreateIndex
CREATE INDEX "team_members_developer_id_idx" ON "team_members"("developer_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_team_id_developer_id_key" ON "team_members"("team_id", "developer_id");

-- CreateIndex
CREATE INDEX "developers_workspace_id_is_bot_idx" ON "developers"("workspace_id", "is_bot");

-- CreateIndex
CREATE INDEX "developers_workspace_id_claimed_by_user_id_idx" ON "developers"("workspace_id", "claimed_by_user_id");

-- CreateIndex
CREATE INDEX "developers_merged_into_id_idx" ON "developers"("merged_into_id");

-- CreateIndex
CREATE INDEX "developer_identities_workspace_id_developer_id_idx" ON "developer_identities"("workspace_id", "developer_id");

-- CreateIndex
CREATE UNIQUE INDEX "developer_identities_workspace_id_provider_kind_value_key" ON "developer_identities"("workspace_id", "provider", "kind", "value");

-- CreateIndex
CREATE INDEX "integrations_workspace_id_status_idx" ON "integrations"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_workspace_id_provider_external_account_id_key" ON "integrations"("workspace_id", "provider", "external_account_id");

-- CreateIndex
CREATE INDEX "sync_cursors_integration_id_idx" ON "sync_cursors"("integration_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_cursors_integration_id_repository_id_resource_key" ON "sync_cursors"("integration_id", "repository_id", "resource");

-- CreateIndex
CREATE INDEX "sync_runs_workspace_id_started_at_idx" ON "sync_runs"("workspace_id", "started_at");

-- CreateIndex
CREATE INDEX "sync_runs_integration_id_status_idx" ON "sync_runs"("integration_id", "status");

-- CreateIndex
CREATE INDEX "raw_events_status_received_at_idx" ON "raw_events"("status", "received_at");

-- CreateIndex
CREATE INDEX "raw_events_workspace_id_received_at_idx" ON "raw_events"("workspace_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "raw_events_provider_event_type_external_id_content_hash_key" ON "raw_events"("provider", "event_type", "external_id", "content_hash");

-- CreateIndex
CREATE INDEX "repositories_workspace_id_sync_enabled_idx" ON "repositories"("workspace_id", "sync_enabled");

-- CreateIndex
CREATE INDEX "repositories_workspace_id_full_name_idx" ON "repositories"("workspace_id", "full_name");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_workspace_id_provider_external_id_key" ON "repositories"("workspace_id", "provider", "external_id");

-- CreateIndex
CREATE INDEX "commits_workspace_id_authored_at_idx" ON "commits"("workspace_id", "authored_at");

-- CreateIndex
CREATE INDEX "commits_repository_id_authored_at_idx" ON "commits"("repository_id", "authored_at");

-- CreateIndex
CREATE INDEX "commits_workspace_id_author_developer_id_authored_at_idx" ON "commits"("workspace_id", "author_developer_id", "authored_at");

-- CreateIndex
CREATE UNIQUE INDEX "commits_repository_id_sha_key" ON "commits"("repository_id", "sha");

-- CreateIndex
CREATE INDEX "pull_requests_workspace_id_state_idx" ON "pull_requests"("workspace_id", "state");

-- CreateIndex
CREATE INDEX "pull_requests_workspace_id_author_developer_id_created_at_r_idx" ON "pull_requests"("workspace_id", "author_developer_id", "created_at_remote");

-- CreateIndex
CREATE INDEX "pull_requests_repository_id_created_at_remote_idx" ON "pull_requests"("repository_id", "created_at_remote");

-- CreateIndex
CREATE UNIQUE INDEX "pull_requests_repository_id_number_key" ON "pull_requests"("repository_id", "number");

-- CreateIndex
CREATE INDEX "pull_request_reviews_pull_request_id_submitted_at_idx" ON "pull_request_reviews"("pull_request_id", "submitted_at");

-- CreateIndex
CREATE INDEX "pull_request_reviews_workspace_id_reviewer_developer_id_sub_idx" ON "pull_request_reviews"("workspace_id", "reviewer_developer_id", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "pull_request_reviews_repository_id_external_id_key" ON "pull_request_reviews"("repository_id", "external_id");

-- CreateIndex
CREATE INDEX "issues_workspace_id_state_idx" ON "issues"("workspace_id", "state");

-- CreateIndex
CREATE INDEX "issues_repository_id_created_at_remote_idx" ON "issues"("repository_id", "created_at_remote");

-- CreateIndex
CREATE INDEX "issues_labels_idx" ON "issues" USING GIN ("labels");

-- CreateIndex
CREATE UNIQUE INDEX "issues_repository_id_number_key" ON "issues"("repository_id", "number");

-- CreateIndex
CREATE INDEX "repository_contributors_workspace_id_developer_id_idx" ON "repository_contributors"("workspace_id", "developer_id");

-- CreateIndex
CREATE UNIQUE INDEX "repository_contributors_repository_id_developer_id_key" ON "repository_contributors"("repository_id", "developer_id");

-- CreateIndex
CREATE INDEX "metric_snapshots_workspace_id_metric_key_granularity_period_idx" ON "metric_snapshots"("workspace_id", "metric_key", "granularity", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "metric_snapshots_workspace_id_subject_type_subject_id_metri_key" ON "metric_snapshots"("workspace_id", "subject_type", "subject_id", "metric_key", "granularity", "period_start");

-- CreateIndex
CREATE INDEX "score_snapshots_workspace_id_score_key_period_start_idx" ON "score_snapshots"("workspace_id", "score_key", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "score_snapshots_workspace_id_subject_type_subject_id_score__key" ON "score_snapshots"("workspace_id", "subject_type", "subject_id", "score_key", "granularity", "period_start");

-- CreateIndex
CREATE INDEX "developer_daily_rollups_workspace_id_day_idx" ON "developer_daily_rollups"("workspace_id", "day");

-- CreateIndex
CREATE INDEX "repository_daily_rollups_workspace_id_day_idx" ON "repository_daily_rollups"("workspace_id", "day");

-- CreateIndex
CREATE INDEX "team_daily_rollups_workspace_id_day_idx" ON "team_daily_rollups"("workspace_id", "day");

-- CreateIndex
CREATE INDEX "insights_workspace_id_status_severity_idx" ON "insights"("workspace_id", "status", "severity");

-- CreateIndex
CREATE INDEX "insights_workspace_id_subject_type_subject_id_idx" ON "insights"("workspace_id", "subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "insights_workspace_id_dedupe_key_key" ON "insights"("workspace_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_workspace_id_idx" ON "notifications"("workspace_id");

-- CreateIndex
CREATE INDEX "reports_workspace_id_created_at_idx" ON "reports"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_created_at_idx" ON "audit_logs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_actor_user_id_idx" ON "audit_logs"("workspace_id", "actor_user_id");

-- AddForeignKey
ALTER TABLE "user_oauth_accounts" ADD CONSTRAINT "user_oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developers" ADD CONSTRAINT "developers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developers" ADD CONSTRAINT "developers_claimed_by_user_id_fkey" FOREIGN KEY ("claimed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developers" ADD CONSTRAINT "developers_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "developers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_identities" ADD CONSTRAINT "developer_identities_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_identities" ADD CONSTRAINT "developer_identities_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commits" ADD CONSTRAINT "commits_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commits" ADD CONSTRAINT "commits_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commits" ADD CONSTRAINT "commits_author_developer_id_fkey" FOREIGN KEY ("author_developer_id") REFERENCES "developers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commits" ADD CONSTRAINT "commits_committer_developer_id_fkey" FOREIGN KEY ("committer_developer_id") REFERENCES "developers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_author_developer_id_fkey" FOREIGN KEY ("author_developer_id") REFERENCES "developers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_merged_by_developer_id_fkey" FOREIGN KEY ("merged_by_developer_id") REFERENCES "developers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_request_reviews" ADD CONSTRAINT "pull_request_reviews_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_request_reviews" ADD CONSTRAINT "pull_request_reviews_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_request_reviews" ADD CONSTRAINT "pull_request_reviews_pull_request_id_fkey" FOREIGN KEY ("pull_request_id") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_request_reviews" ADD CONSTRAINT "pull_request_reviews_reviewer_developer_id_fkey" FOREIGN KEY ("reviewer_developer_id") REFERENCES "developers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_author_developer_id_fkey" FOREIGN KEY ("author_developer_id") REFERENCES "developers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_assignee_developer_id_fkey" FOREIGN KEY ("assignee_developer_id") REFERENCES "developers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_contributors" ADD CONSTRAINT "repository_contributors_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_contributors" ADD CONSTRAINT "repository_contributors_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_contributors" ADD CONSTRAINT "repository_contributors_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_daily_rollups" ADD CONSTRAINT "developer_daily_rollups_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_daily_rollups" ADD CONSTRAINT "developer_daily_rollups_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_daily_rollups" ADD CONSTRAINT "repository_daily_rollups_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_daily_rollups" ADD CONSTRAINT "repository_daily_rollups_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_daily_rollups" ADD CONSTRAINT "team_daily_rollups_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_daily_rollups" ADD CONSTRAINT "team_daily_rollups_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_insight_id_fkey" FOREIGN KEY ("insight_id") REFERENCES "insights"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
