CREATE TABLE `content_assets` (
	`release_id` text NOT NULL,
	`kind` text NOT NULL,
	`content_version` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_count` integer NOT NULL,
	`item_count` integer NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`release_id`, `kind`),
	FOREIGN KEY (`release_id`) REFERENCES `content_releases`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "content_assets_kind_check" CHECK("content_assets"."kind" in ('party_deck', 'solo_gist')),
	CONSTRAINT "content_assets_bytes_check" CHECK("content_assets"."byte_count" > 0),
	CONSTRAINT "content_assets_items_check" CHECK("content_assets"."item_count" > 0)
);
--> statement-breakpoint
CREATE INDEX `content_assets_hash_idx` ON `content_assets` (`sha256`);--> statement-breakpoint
CREATE INDEX `content_assets_release_idx` ON `content_assets` (`release_id`,`kind`);--> statement-breakpoint
CREATE TABLE `content_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`effective_week_wat` text NOT NULL,
	`effective_from_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`minimum_app_version` text DEFAULT '1.0.0' NOT NULL,
	`published_by` text NOT NULL,
	`published_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "content_releases_revision_check" CHECK("content_releases"."revision" > 0),
	CONSTRAINT "content_releases_schema_check" CHECK("content_releases"."schema_version" > 0),
	CONSTRAINT "content_releases_status_check" CHECK("content_releases"."status" in ('published', 'superseded', 'revoked')),
	CONSTRAINT "content_releases_schedule_check" CHECK("content_releases"."expires_at_ms" > "content_releases"."effective_from_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_releases_revision_unique` ON `content_releases` (`revision`);--> statement-breakpoint
CREATE INDEX `content_releases_active_idx` ON `content_releases` (`status`,`effective_from_ms`,`expires_at_ms`,`revision`);--> statement-breakpoint
CREATE INDEX `content_releases_week_idx` ON `content_releases` (`effective_week_wat`,`status`,`revision`);