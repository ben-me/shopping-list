CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`email` text NOT NULL,
	`invited_by_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`token` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_unique` ON `invitations` (`token`);--> statement-breakpoint
CREATE INDEX `invitations_list_id_idx` ON `invitations` (`list_id`);--> statement-breakpoint
CREATE INDEX `invitations_email_idx` ON `invitations` (`email`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`checked` integer DEFAULT false NOT NULL,
	`checked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `items_list_id_idx` ON `items` (`list_id`);--> statement-breakpoint
CREATE TABLE `lists` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`split_rule` text DEFAULT 'equal' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lists_owner_id_idx` ON `lists` (`owner_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`list_id` text NOT NULL,
	`member_id` text NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`list_id`, `member_id`),
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memberships_member_id_idx` ON `memberships` (`member_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`member_id` text NOT NULL,
	`amount_in_cents` integer NOT NULL,
	`paid_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payments_list_id_idx` ON `payments` (`list_id`);--> statement-breakpoint
CREATE INDEX `payments_member_id_idx` ON `payments` (`member_id`);