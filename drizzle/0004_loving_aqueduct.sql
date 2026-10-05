CREATE TABLE `attempt_card_issues` (
	`attempt_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`card_id` text NOT NULL,
	`issued_at` integer NOT NULL,
	`answered_at` integer,
	PRIMARY KEY(`attempt_id`, `ordinal`),
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `competition_cards`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attempt_card_issues_ordinal_check" CHECK("attempt_card_issues"."ordinal" > 0),
	CONSTRAINT "attempt_card_issues_answer_time_check" CHECK("attempt_card_issues"."answered_at" is null or "attempt_card_issues"."answered_at" >= "attempt_card_issues"."issued_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_card_issues_card_unique` ON `attempt_card_issues` (`attempt_id`,`card_id`);--> statement-breakpoint
CREATE INDEX `attempt_card_issues_attempt_idx` ON `attempt_card_issues` (`attempt_id`,`issued_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`player_id` text NOT NULL,
	`attempt_token_hash` text NOT NULL,
	`status` text DEFAULT 'started' NOT NULL,
	`rules_version` text NOT NULL,
	`pack_version` text NOT NULL,
	`pack_hash` text,
	`scoring_version` text NOT NULL,
	`delivery_protocol` text DEFAULT 'practice_batch_v1' NOT NULL,
	`started_at` integer NOT NULL,
	`play_deadline_at` integer NOT NULL,
	`submit_deadline_at` integer NOT NULL,
	`submitted_at` integer,
	`client_active_ms` integer,
	`server_elapsed_ms` integer,
	`adjusted_total_ms` integer,
	`correct_count` integer,
	`hard_card_ms` integer,
	`integrity_status` text DEFAULT 'pending' NOT NULL,
	`integrity_flags_json` text DEFAULT '[]' NOT NULL,
	`submission_hash` text,
	`score_status` text DEFAULT 'unscored' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attempts_status_check" CHECK("__new_attempts"."status" in ('started', 'submitted', 'expired', 'voided')),
	CONSTRAINT "attempts_integrity_status_check" CHECK("__new_attempts"."integrity_status" in ('pending', 'review', 'passed', 'failed')),
	CONSTRAINT "attempts_score_status_check" CHECK("__new_attempts"."score_status" in ('unscored', 'provisional', 'confirmed', 'voided')),
	CONSTRAINT "attempts_delivery_protocol_check" CHECK("__new_attempts"."delivery_protocol" in ('practice_batch_v1', 'cash_sequential_v1'))
);
--> statement-breakpoint
-- Existing attempts predate the explicit delivery protocol and are always
-- practice batches. Do not select a column that is not present in the old
-- table: a real D1 migration must preserve those historical attempts.
INSERT INTO `__new_attempts`("id", "competition_id", "player_id", "attempt_token_hash", "status", "rules_version", "pack_version", "pack_hash", "scoring_version", "delivery_protocol", "started_at", "play_deadline_at", "submit_deadline_at", "submitted_at", "client_active_ms", "server_elapsed_ms", "adjusted_total_ms", "correct_count", "hard_card_ms", "integrity_status", "integrity_flags_json", "submission_hash", "score_status", "created_at", "updated_at") SELECT "id", "competition_id", "player_id", "attempt_token_hash", "status", "rules_version", "pack_version", "pack_hash", "scoring_version", 'practice_batch_v1', "started_at", "play_deadline_at", "submit_deadline_at", "submitted_at", "client_active_ms", "server_elapsed_ms", "adjusted_total_ms", "correct_count", "hard_card_ms", "integrity_status", "integrity_flags_json", "submission_hash", "score_status", "created_at", "updated_at" FROM `attempts`;--> statement-breakpoint
DROP TABLE `attempts`;--> statement-breakpoint
ALTER TABLE `__new_attempts` RENAME TO `attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `attempts_one_per_player_competition` ON `attempts` (`competition_id`,`player_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `attempts_token_hash_unique` ON `attempts` (`attempt_token_hash`);--> statement-breakpoint
CREATE INDEX `attempts_player_idx` ON `attempts` (`player_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `attempts_leaderboard_idx` ON `attempts` (`competition_id`,`score_status`,`correct_count`,`adjusted_total_ms`,`hard_card_ms`);
