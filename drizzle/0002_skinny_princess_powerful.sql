CREATE TABLE `generated_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`provider` text NOT NULL,
	`code` text NOT NULL,
	`deep_link` text,
	`selections_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_email`) REFERENCES `users`(`email`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `generated_codes_user_created_idx` ON `generated_codes` (`user_email`,`created_at`);