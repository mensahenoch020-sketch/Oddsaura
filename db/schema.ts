import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userEmail: text("user_email").notNull().references(() => users.email, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("sessions_user_expires_idx").on(table.userEmail, table.expiresAt)]);

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userEmail: text("user_email").notNull().references(() => users.email, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("password_reset_user_expires_idx").on(table.userEmail, table.expiresAt)]);

export const savedSlips = sqliteTable("saved_slips", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull().references(() => users.email, { onDelete: "cascade" }),
  name: text("name").notNull(),
  picksJson: text("picks_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("saved_slips_user_created_idx").on(table.userEmail, table.createdAt)]);
