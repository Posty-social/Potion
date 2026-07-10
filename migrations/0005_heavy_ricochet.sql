CREATE TABLE `user_pin` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`song_id` text NOT NULL,
	`position` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_pin_position_limit" CHECK("user_pin"."position" BETWEEN 1 AND 4)
);
--> statement-breakpoint
CREATE INDEX `user_pin_user_id_idx` ON `user_pin` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_pin_user_song_idx` ON `user_pin` (`user_id`,`song_id`);