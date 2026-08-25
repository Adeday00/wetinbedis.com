CREATE TABLE `attempt_answers` (
	`attempt_id` text NOT NULL,
	`card_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`selected_option_id` text NOT NULL,
	`client_response_ms` integer NOT NULL,
	`is_correct` integer NOT NULL,
	`answer_version` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`attempt_id`, `card_id`),
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `competition_cards`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attempt_answers_ordinal_check" CHECK("attempt_answers"."ordinal" > 0),
	CONSTRAINT "attempt_answers_response_ms_check" CHECK("attempt_answers"."client_response_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_answers_ordinal_unique` ON `attempt_answers` (`attempt_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `attempt_answers_card_idx` ON `attempt_answers` (`card_id`);--> statement-breakpoint
CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`player_id` text NOT NULL,
	`attempt_token_hash` text NOT NULL,
	`status` text DEFAULT 'started' NOT NULL,
	`rules_version` text NOT NULL,
	`pack_version` text NOT NULL,
	`scoring_version` text NOT NULL,
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
	CONSTRAINT "attempts_status_check" CHECK("attempts"."status" in ('started', 'submitted', 'expired', 'voided')),
	CONSTRAINT "attempts_integrity_status_check" CHECK("attempts"."integrity_status" in ('pending', 'review', 'passed', 'failed')),
	CONSTRAINT "attempts_score_status_check" CHECK("attempts"."score_status" in ('unscored', 'provisional', 'confirmed', 'voided'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attempts_one_per_player_competition` ON `attempts` (`competition_id`,`player_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `attempts_token_hash_unique` ON `attempts` (`attempt_token_hash`);--> statement-breakpoint
CREATE INDEX `attempts_player_idx` ON `attempts` (`player_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `attempts_leaderboard_idx` ON `attempts` (`competition_id`,`score_status`,`correct_count`,`adjusted_total_ms`,`hard_card_ms`);--> statement-breakpoint
CREATE TABLE `competition_card_options` (
	`card_id` text NOT NULL,
	`option_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	`category` text NOT NULL,
	`answer_family` text NOT NULL,
	PRIMARY KEY(`card_id`, `option_id`),
	FOREIGN KEY (`card_id`) REFERENCES `competition_cards`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "competition_card_options_position_check" CHECK("competition_card_options"."position" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `competition_card_options_position_unique` ON `competition_card_options` (`card_id`,`position`);--> statement-breakpoint
CREATE TABLE `competition_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`source_card_id` text NOT NULL,
	`position` integer NOT NULL,
	`content_version` text NOT NULL,
	`category` text NOT NULL,
	`answer_family` text NOT NULL,
	`clues_json` text NOT NULL,
	`correct_option_id` text NOT NULL,
	`difficulty` text DEFAULT 'standard' NOT NULL,
	`editorial_status` text DEFAULT 'draft' NOT NULL,
	`verification_note` text,
	`source_urls_json` text DEFAULT '[]' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`voided_at` integer,
	`void_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "competition_cards_position_check" CHECK("competition_cards"."position" > 0),
	CONSTRAINT "competition_cards_difficulty_check" CHECK("competition_cards"."difficulty" in ('standard', 'hard')),
	CONSTRAINT "competition_cards_editorial_status_check" CHECK("competition_cards"."editorial_status" in ('draft', 'in_review', 'approved', 'rejected', 'voided'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `competition_cards_position_unique` ON `competition_cards` (`competition_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `competition_cards_source_unique` ON `competition_cards` (`competition_id`,`source_card_id`);--> statement-breakpoint
CREATE INDEX `competition_cards_pack_idx` ON `competition_cards` (`competition_id`,`editorial_status`,`position`);--> statement-breakpoint
CREATE TABLE `competition_prizes` (
	`competition_id` text NOT NULL,
	`place` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	PRIMARY KEY(`competition_id`, `place`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "competition_prizes_place_check" CHECK("competition_prizes"."place" > 0),
	CONSTRAINT "competition_prizes_amount_check" CHECK("competition_prizes"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE `competitions` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`content_status` text DEFAULT 'draft' NOT NULL,
	`rules_version` text NOT NULL,
	`pack_version` text NOT NULL,
	`scoring_version` text DEFAULT 'accuracy-time-v1' NOT NULL,
	`question_count` integer DEFAULT 12 NOT NULL,
	`per_card_limit_ms` integer DEFAULT 12000 NOT NULL,
	`upload_grace_ms` integer DEFAULT 15000 NOT NULL,
	`entry_mode` text DEFAULT 'phone_verified' NOT NULL,
	`country_code` text DEFAULT 'NG' NOT NULL,
	`minimum_age` integer DEFAULT 18 NOT NULL,
	`currency` text DEFAULT 'NGN' NOT NULL,
	`opens_at` integer NOT NULL,
	`closes_at` integer NOT NULL,
	`score_review_closes_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "competitions_status_check" CHECK("competitions"."status" in ('draft', 'scheduled', 'open', 'locked', 'final', 'cancelled')),
	CONSTRAINT "competitions_content_status_check" CHECK("competitions"."content_status" in ('draft', 'in_review', 'approved', 'published')),
	CONSTRAINT "competitions_entry_mode_check" CHECK("competitions"."entry_mode" in ('guest', 'account', 'phone_verified')),
	CONSTRAINT "competitions_question_count_check" CHECK("competitions"."question_count" > 0),
	CONSTRAINT "competitions_card_limit_check" CHECK("competitions"."per_card_limit_ms" > 0),
	CONSTRAINT "competitions_schedule_check" CHECK("competitions"."closes_at" > "competitions"."opens_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `competitions_slug_unique` ON `competitions` (`slug`);--> statement-breakpoint
CREATE INDEX `competitions_current_idx` ON `competitions` (`status`,`content_status`,`opens_at`,`closes_at`);--> statement-breakpoint
CREATE TABLE `player_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`platform` text NOT NULL,
	`app_version` text,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "player_sessions_platform_check" CHECK("player_sessions"."platform" in ('ios', 'android', 'web', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_sessions_token_hash_unique` ON `player_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `player_sessions_player_id_idx` ON `player_sessions` (`player_id`);--> statement-breakpoint
CREATE INDEX `player_sessions_expiry_idx` ON `player_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`public_handle` text NOT NULL,
	`account_state` text DEFAULT 'guest' NOT NULL,
	`phone_lookup_hash` text,
	`phone_verified_at` integer,
	`eligibility_status` text DEFAULT 'guest' NOT NULL,
	`accepted_rules_version` text,
	`eligibility_attested_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "players_account_state_check" CHECK("players"."account_state" in ('guest', 'phone_verified', 'suspended')),
	CONSTRAINT "players_eligibility_status_check" CHECK("players"."eligibility_status" in ('guest', 'pending', 'eligible', 'ineligible', 'suspended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_public_handle_unique` ON `players` (`public_handle`);--> statement-breakpoint
CREATE UNIQUE INDEX `players_phone_lookup_hash_unique` ON `players` (`phone_lookup_hash`);--> statement-breakpoint
CREATE TABLE `score_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`player_id` text NOT NULL,
	`competition_id` text NOT NULL,
	`card_id` text,
	`kind` text NOT NULL,
	`statement` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text,
	`resolved_by` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`card_id`) REFERENCES `competition_cards`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "score_challenges_kind_check" CHECK("score_challenges"."kind" in ('card_answer', 'timer', 'score', 'other')),
	CONSTRAINT "score_challenges_status_check" CHECK("score_challenges"."status" in ('open', 'under_review', 'upheld', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE INDEX `score_challenges_queue_idx` ON `score_challenges` (`competition_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `score_challenges_player_idx` ON `score_challenges` (`player_id`,`created_at`);