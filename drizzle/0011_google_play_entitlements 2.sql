CREATE TABLE `google_play_purchases` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `player_id` text NOT NULL REFERENCES `players`(`id`) ON DELETE cascade,
  `product_id` text NOT NULL,
  `package_name` text NOT NULL,
  `order_id` text,
  `purchase_state` integer NOT NULL,
  `acknowledged_at` integer,
  `verified_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `google_play_purchases_player_idx` ON `google_play_purchases` (`player_id`,`product_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_play_purchases_order_unique` ON `google_play_purchases` (`order_id`);
--> statement-breakpoint
CREATE TABLE `player_entitlements` (
  `player_id` text NOT NULL REFERENCES `players`(`id`) ON DELETE cascade,
  `product_id` text NOT NULL,
  `source` text NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`player_id`,`product_id`),
  CONSTRAINT `player_entitlements_active_check` CHECK (`active` in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `player_entitlements_active_idx` ON `player_entitlements` (`player_id`,`active`);
