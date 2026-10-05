CREATE TABLE `content_release_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`changed_at` integer NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `content_releases`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `content_release_audit_release_idx` ON `content_release_audit` (`release_id`,`changed_at`);
