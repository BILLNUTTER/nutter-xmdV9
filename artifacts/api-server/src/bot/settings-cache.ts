import { db } from "@workspace/db";
import { userSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type Settings = typeof userSettingsTable.$inferSelect;

const TTL = 60_000;

interface Entry {
  data: Settings;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

export async function getCachedSettings(userId: string): Promise<Settings | null> {
  const entry = cache.get(userId);
  if (entry && Date.now() < entry.expiresAt) return entry.data;

  const [settings] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId));

  if (!settings) return null;
  cache.set(userId, { data: settings, expiresAt: Date.now() + TTL });
  return settings;
}

export function invalidateSettingsCache(userId: string): void {
  cache.delete(userId);
}

export function setSettingsCache(userId: string, settings: Settings): void {
  cache.set(userId, { data: settings, expiresAt: Date.now() + TTL });
}
