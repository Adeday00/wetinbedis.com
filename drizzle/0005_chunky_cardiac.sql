CREATE TABLE `notification_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`platform` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_ciphertext` text NOT NULL,
	`league_updates_enabled` integer DEFAULT 0 NOT NULL,
	`friend_invites_enabled` integer DEFAULT 0 NOT NULL,
	`offers_enabled` integer DEFAULT 0 NOT NULL,
	`consented_at` integer NOT NULL,
	`last_registered_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_devices_platform_check" CHECK("notification_devices"."platform" in ('ios', 'android')),
	CONSTRAINT "notification_devices_preference_check" CHECK("notification_devices"."league_updates_enabled" in (0, 1)
        and "notification_devices"."friend_invites_enabled" in (0, 1)
        and "notification_devices"."offers_enabled" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_devices_platform_token_unique` ON `notification_devices` (`platform`,`token_hash`);--> statement-breakpoint
CREATE INDEX `notification_devices_player_idx` ON `notification_devices` (`player_id`,`updated_at`);