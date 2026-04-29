CREATE TABLE `pending_review_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`kind` text NOT NULL,
	`provider_comment_id` text,
	`provider_thread_id` text,
	`reply_to_thread_id` text,
	`body` text NOT NULL,
	`path` text NOT NULL,
	`old_path` text NOT NULL,
	`new_path` text NOT NULL,
	`line` integer,
	`side` text,
	`start_line` integer,
	`start_side` text,
	`subject_type` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pending_review_comments_session` ON `pending_review_comments` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pending_review_comments_provider_comment` ON `pending_review_comments` (`session_id`,`provider_comment_id`);--> statement-breakpoint
CREATE TABLE `pending_review_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_row_id` integer NOT NULL,
	`pr_number` integer NOT NULL,
	`head_sha` text NOT NULL,
	`provider_review_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pending_review_sessions_repo_pr` ON `pending_review_sessions` (`repo_row_id`,`pr_number`);--> statement-breakpoint
CREATE INDEX `idx_pending_review_sessions_repo_pr_head` ON `pending_review_sessions` (`repo_row_id`,`pr_number`,`head_sha`);