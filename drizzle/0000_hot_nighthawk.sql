CREATE TABLE `saved_slips` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`name` text NOT NULL,
	`picks_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_email`) REFERENCES `users`(`email`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_slips_user_created_idx` ON `saved_slips` (`user_email`,`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`email` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
