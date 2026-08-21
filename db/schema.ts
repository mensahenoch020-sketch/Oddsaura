import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const savedSlips = sqliteTable("saved_slips", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull().references(() => users.email, { onDelete: "cascade" }),
  name: text("name").notNull(),
  picksJson: text("picks_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("saved_slips_user_created_idx").on(table.userEmail, table.createdAt)]);
