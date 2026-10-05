CREATE TABLE `party_deck_editor_state` (
	`id` text PRIMARY KEY NOT NULL,
	`cards_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
