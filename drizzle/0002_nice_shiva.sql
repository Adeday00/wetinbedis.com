PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_content_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`effective_week_wat` text NOT NULL,
	`effective_from_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`minimum_app_version` text DEFAULT '1.0.0' NOT NULL,
	`sponsor_kind` text,
	`sponsor_name` text,
	`sponsor_message` text,
	`published_by` text NOT NULL,
	`published_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "content_releases_revision_check" CHECK("__new_content_releases"."revision" > 0),
	CONSTRAINT "content_releases_schema_check" CHECK("__new_content_releases"."schema_version" > 0),
	CONSTRAINT "content_releases_status_check" CHECK("__new_content_releases"."status" in ('published', 'superseded', 'revoked')),
	CONSTRAINT "content_releases_schedule_check" CHECK("__new_content_releases"."expires_at_ms" > "__new_content_releases"."effective_from_ms"),
	CONSTRAINT "content_releases_sponsor_kind_check" CHECK("__new_content_releases"."sponsor_kind" is null or "__new_content_releases"."sponsor_kind" in ('commercial', 'prizeFunding'))
);
--> statement-breakpoint
INSERT INTO `__new_content_releases`("id", "revision", "schema_version", "status", "effective_week_wat", "effective_from_ms", "expires_at_ms", "minimum_app_version", "sponsor_kind", "sponsor_name", "sponsor_message", "published_by", "published_at", "created_at") SELECT "id", "revision", "schema_version", "status", "effective_week_wat", "effective_from_ms", "expires_at_ms", "minimum_app_version", NULL, NULL, NULL, "published_by", "published_at", "created_at" FROM `content_releases`;--> statement-breakpoint
DROP TABLE `content_releases`;--> statement-breakpoint
ALTER TABLE `__new_content_releases` RENAME TO `content_releases`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `content_releases_revision_unique` ON `content_releases` (`revision`);--> statement-breakpoint
CREATE INDEX `content_releases_active_idx` ON `content_releases` (`status`,`effective_from_ms`,`expires_at_ms`,`revision`);--> statement-breakpoint
CREATE INDEX `content_releases_week_idx` ON `content_releases` (`effective_week_wat`,`status`,`revision`);
