CREATE TABLE `app_config_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`config_json` text NOT NULL,
	`created_by` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	`published_at` integer,
	CONSTRAINT "app_config_revisions_status_check" CHECK("app_config_revisions"."status" in ('draft', 'review', 'published', 'rolled_back', 'revoked', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_config_revisions_revision_unique` ON `app_config_revisions` (`revision`);--> statement-breakpoint
CREATE INDEX `app_config_revisions_public_idx` ON `app_config_revisions` (`status`,`revision`);--> statement-breakpoint
CREATE TABLE `app_config_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`changed_at` integer NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `app_config_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `app_config_audit_revision_idx` ON `app_config_audit` (`revision_id`,`changed_at`);
