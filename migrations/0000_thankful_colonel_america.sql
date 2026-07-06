CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`mime` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `asset_org_id_idx` ON `asset` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `asset_r2_key_idx` ON `asset` (`r2_key`);--> statement-breakpoint
CREATE TABLE `block` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`parent_block_id` text,
	`type` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`properties` text DEFAULT '{}' NOT NULL,
	`collection_id` text,
	`position` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`last_edited_by_user_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_block_id`) REFERENCES `block`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_edited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `block_page_parent_position_idx` ON `block` (`page_id`,`parent_block_id`,`position`);--> statement-breakpoint
CREATE INDEX `block_collection_id_idx` ON `block` (`collection_id`);--> statement-breakpoint
CREATE TABLE `collection` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`page_id` text,
	`title` text NOT NULL,
	`schema` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_org_id_idx` ON `collection` (`organization_id`);--> statement-breakpoint
CREATE INDEX `collection_page_id_idx` ON `collection` (`page_id`);--> statement-breakpoint
CREATE TABLE `collection_row` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`values` text DEFAULT '{}' NOT NULL,
	`position` text NOT NULL,
	`page_id` text,
	`created_by_user_id` text NOT NULL,
	`last_edited_by_user_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_edited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `collection_row_collection_position_idx` ON `collection_row` (`collection_id`,`position`);--> statement-breakpoint
CREATE TABLE `collection_view` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`position` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_view_collection_position_idx` ON `collection_view` (`collection_id`,`position`);--> statement-breakpoint
CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`page_id` text NOT NULL,
	`block_id` text,
	`parent_comment_id` text,
	`author_user_id` text NOT NULL,
	`body` text NOT NULL,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`block_id`) REFERENCES `block`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_comment_id`) REFERENCES `comment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_page_block_idx` ON `comment` (`page_id`,`block_id`);--> statement-breakpoint
CREATE INDEX `comment_org_id_idx` ON `comment` (`organization_id`);--> statement-breakpoint
CREATE TABLE `page` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`parent_page_id` text,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`icon` text,
	`cover_asset_id` text,
	`position` text NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_by_user_id` text NOT NULL,
	`last_edited_by_user_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cover_asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_edited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `page_org_parent_position_idx` ON `page` (`organization_id`,`parent_page_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_org_slug_idx` ON `page` (`organization_id`,`slug`);--> statement-breakpoint
CREATE TABLE `page_permission` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`access` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_permission_subject_idx` ON `page_permission` (`page_id`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `page_permission_org_id_idx` ON `page_permission` (`organization_id`);--> statement-breakpoint
CREATE TABLE `public_link` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`token` text NOT NULL,
	`include_child_pages` integer DEFAULT false NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_link_token_idx` ON `public_link` (`token`);--> statement-breakpoint
CREATE INDEX `public_link_page_id_idx` ON `public_link` (`page_id`);--> statement-breakpoint
CREATE INDEX `public_link_org_id_idx` ON `public_link` (`organization_id`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `apikey` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text DEFAULT 'default' NOT NULL,
	`name` text,
	`start` text,
	`reference_id` text NOT NULL,
	`prefix` text,
	`key` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`rate_limit_enabled` integer DEFAULT true NOT NULL,
	`rate_limit_time_window` integer,
	`rate_limit_max` integer,
	`request_count` integer DEFAULT 0 NOT NULL,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`permissions` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `apikey_config_id_idx` ON `apikey` (`config_id`);--> statement-breakpoint
CREATE INDEX `apikey_reference_id_idx` ON `apikey` (`reference_id`);--> statement-breakpoint
CREATE INDEX `apikey_key_idx` ON `apikey` (`key`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_org_id_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_user_id_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_org_user_idx` ON `member` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`access_token_expires_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`refresh_token_expires_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text,
	`scopes` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_application`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_access_token_access_token_idx` ON `oauth_access_token` (`access_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_access_token_refresh_token_idx` ON `oauth_access_token` (`refresh_token`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_client_id_idx` ON `oauth_access_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_user_id_idx` ON `oauth_access_token` (`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_application` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`metadata` text,
	`client_id` text NOT NULL,
	`client_secret` text,
	`redirect_urls` text NOT NULL,
	`type` text NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_application_client_id_idx` ON `oauth_application` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_application_user_id_idx` ON `oauth_application` (`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_consent` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`consent_given` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_application`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_consent_client_id_idx` ON `oauth_consent` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_consent_user_id_idx` ON `oauth_consent` (`user_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_idx` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`active_organization_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_idx` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_idx` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);