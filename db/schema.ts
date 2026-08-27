import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  role: text("role", { enum: ["USER", "ADMIN"] }).notNull().default("USER"),
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

export const generatedCodes = sqliteTable("generated_codes", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull().references(() => users.email, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  code: text("code").notNull(),
  deepLink: text("deep_link"),
  selectionsJson: text("selections_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("generated_codes_user_created_idx").on(table.userEmail, table.createdAt)]);

export const ticketControls = sqliteTable("ticket_controls", {
  ticketId: text("ticket_id").primaryKey(),
  visible: integer("visible", { mode: "boolean" }).notNull().default(true),
  titleOverride: text("title_override"),
  updatedBy: text("updated_by").notNull().references(() => users.email),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
