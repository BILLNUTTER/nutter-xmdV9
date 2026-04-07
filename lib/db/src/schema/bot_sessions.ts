import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const botSessionsTable = pgTable("bot_sessions", {
  botId:     text("bot_id").primaryKey(),
  creds:     jsonb("creds"),
  keys:      jsonb("keys").notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BotSession = typeof botSessionsTable.$inferSelect;
