ALTER TABLE `page` ADD `properties` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `page` ADD `property_values` text DEFAULT '{}' NOT NULL;