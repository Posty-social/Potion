ALTER TABLE `collection_row` ADD `is_archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `collection_row` ADD `archived_at` integer;