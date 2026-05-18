CREATE TABLE `pull_request_data_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`account_id` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_path` text,
	`resource_namespace_kind` text,
	`resource_repo_json` text,
	`statuses_json` text NOT NULL,
	`sort_by` text NOT NULL,
	`group_by_project` integer NOT NULL,
	`position` integer NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pr_data_sources_account` ON `pull_request_data_sources` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_pr_data_sources_position` ON `pull_request_data_sources` (`position`);--> statement-breakpoint
CREATE INDEX `idx_pr_data_sources_active` ON `pull_request_data_sources` (`is_active`);
