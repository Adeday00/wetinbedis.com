CREATE TABLE `competition_payout_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`payout_id` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`note` text NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`changed_at` integer NOT NULL,
	FOREIGN KEY (`payout_id`) REFERENCES `competition_payouts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `competition_payout_audit_idx` ON `competition_payout_audit` (`payout_id`,`changed_at`);--> statement-breakpoint
CREATE TABLE `competition_payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`player_id` text NOT NULL,
	`place` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'NGN' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`transfer_reference` text,
	`failure_reason` text,
	`created_by` text NOT NULL,
	`approved_by` text,
	`approved_at` integer,
	`sent_by` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "competition_payouts_place_check" CHECK("competition_payouts"."place" > 0),
	CONSTRAINT "competition_payouts_amount_check" CHECK("competition_payouts"."amount_minor" > 0),
	CONSTRAINT "competition_payouts_status_check" CHECK("competition_payouts"."status" in ('pending', 'approved', 'sent', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `competition_payouts_attempt_unique` ON `competition_payouts` (`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `competition_payouts_place_unique` ON `competition_payouts` (`competition_id`,`place`);--> statement-breakpoint
CREATE INDEX `competition_payouts_status_idx` ON `competition_payouts` (`competition_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `competition_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`competition_id` text NOT NULL,
	`player_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`risk_score` integer DEFAULT 0 NOT NULL,
	`flags_json` text DEFAULT '[]' NOT NULL,
	`note` text,
	`reviewer` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "competition_reviews_status_check" CHECK("competition_reviews"."status" in ('queued', 'in_review', 'cleared', 'voided')),
	CONSTRAINT "competition_reviews_risk_score_check" CHECK("competition_reviews"."risk_score" between 0 and 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `competition_reviews_attempt_unique` ON `competition_reviews` (`attempt_id`);--> statement-breakpoint
CREATE INDEX `competition_reviews_queue_idx` ON `competition_reviews` (`competition_id`,`status`,`created_at`);