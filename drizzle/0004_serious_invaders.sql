CREATE TABLE `ticket_controls` (
	`ticket_id` text PRIMARY KEY NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`title_override` text,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`email`) ON UPDATE no action ON DELETE no action
);
