CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`client_id` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` integer,
	`scopes_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_auth_tokens_account` ON `auth_tokens` (`account_id`);--> statement-breakpoint
CREATE TABLE `pr_changed_files_cache` (
	`repo_row_id` integer NOT NULL,
	`pr_number` integer NOT NULL,
	`head_sha` text NOT NULL,
	`files_json` text NOT NULL,
	`cached_at` integer NOT NULL,
	`last_accessed_at` integer NOT NULL,
	PRIMARY KEY(`repo_row_id`, `pr_number`, `head_sha`)
);
--> statement-breakpoint
CREATE TABLE `pr_patch_cache` (
	`repo_row_id` integer NOT NULL,
	`pr_number` integer NOT NULL,
	`head_sha` text NOT NULL,
	`patch_text` text NOT NULL,
	`cached_at` integer NOT NULL,
	`last_accessed_at` integer NOT NULL,
	PRIMARY KEY(`repo_row_id`, `pr_number`, `head_sha`)
);
--> statement-breakpoint
CREATE TABLE `provider_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`provider` text NOT NULL,
	`host` text NOT NULL,
	`login` text,
	`is_enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_profiles_account_id_unique` ON `provider_profiles` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_profiles_provider_host_login` ON `provider_profiles` (`provider`,`host`,`login`);--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`repo_row_id` integer NOT NULL,
	`pr_number` integer NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`is_draft` integer DEFAULT false NOT NULL,
	`tracked_at` integer,
	`tracked_position` integer,
	`merge_state_status` text DEFAULT 'UNKNOWN' NOT NULL,
	`mergeable` text DEFAULT 'UNKNOWN' NOT NULL,
	`additions` integer,
	`deletions` integer,
	`change_count` integer,
	`author_login` text NOT NULL,
	`updated_at` text NOT NULL,
	`head_sha` text NOT NULL,
	`base_sha` text,
	`url` text,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pull_requests_repo_pr_number` ON `pull_requests` (`repo_row_id`,`pr_number`);--> statement-breakpoint
CREATE INDEX `idx_pull_requests_repo_updated` ON `pull_requests` (`repo_row_id`,"updated_at" desc);--> statement-breakpoint
CREATE INDEX `idx_pull_requests_tracked_position` ON `pull_requests` (`tracked_position`,`tracked_at`);--> statement-breakpoint
CREATE INDEX `idx_pull_requests_repo_tracked` ON `pull_requests` (`repo_row_id`,`tracked_at`);--> statement-breakpoint
CREATE TABLE `repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_id` text NOT NULL,
	`repo_key` text NOT NULL,
	`provider` text NOT NULL,
	`host` text NOT NULL,
	`provider_profile_id` integer NOT NULL,
	`name` text NOT NULL,
	`name_with_owner` text NOT NULL,
	`description` text,
	`is_private` integer,
	`avatar_url` text,
	`added_at` integer NOT NULL,
	`last_opened_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_repos_provider_id_repo_key` ON `repos` (`provider_id`,`repo_key`);--> statement-breakpoint
CREATE INDEX `idx_repos_provider_host` ON `repos` (`provider`,`host`,`provider_profile_id`,`repo_key`);
