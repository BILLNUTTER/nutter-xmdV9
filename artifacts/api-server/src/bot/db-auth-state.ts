/**
 * DB-backed WhatsApp auth state for Baileys.
 *
 * Architecture:
 *   users.session_id  — UUID assigned at bot creation; stored in Supabase.
 *                       On server restart the server reads all users with a
 *                       session_id and wakes up each bot automatically.
 *
 *   bot_sessions      — Supabase table keyed on session_id (UUID).
 *                       Stores the WhatsApp auth data (creds + Signal keys)
 *                       so bots reconnect without re-pairing after restarts.
 *
 * Credentials are serialised through BufferJSON so binary values survive
 * the JSONB round-trip in PostgreSQL.
 */

import {
  initAuthCreds,
  BufferJSON,
  type AuthenticationCreds,
  type SignalDataTypeMap,
  type SignalDataSet,
} from "@whiskeysockets/baileys";
import { db } from "@workspace/db";
import { botSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type KeyMap = Record<string, Record<string, unknown>>;

function toJsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}

function revive(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(revive);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (
      (obj["type"] === "Buffer" || obj["buffer"] === true) &&
      Array.isArray(obj["data"])
    ) {
      return Buffer.from(obj["data"] as number[]);
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, revive(v)]));
  }
  return value;
}

async function upsertCreds(sessionId: string, creds: unknown): Promise<void> {
  await db
    .insert(botSessionsTable)
    .values({ sessionId, creds: creds as Record<string, unknown>, keys: {}, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: botSessionsTable.sessionId,
      set: { creds: creds as Record<string, unknown>, updatedAt: new Date() },
    });
}

async function upsertKeys(sessionId: string, keys: unknown): Promise<void> {
  await db
    .insert(botSessionsTable)
    .values({ sessionId, creds: null, keys: keys as Record<string, unknown>, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: botSessionsTable.sessionId,
      set: { keys: keys as Record<string, unknown>, updatedAt: new Date() },
    });
}

function makeKeyStore(
  keys: KeyMap,
  sessionId: string
): {
  get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T] }>;
  set(data: SignalDataSet): Promise<void>;
} {
  let dirty = false;
  let timer: NodeJS.Timeout | null = null;

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      if (!dirty) return;
      dirty = false;
      await upsertKeys(sessionId, toJsonSafe(keys)).catch(() => {});
    }, 1_500);
  }

  return {
    get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
      const bucket = (keys[type as string] ?? {}) as Record<string, SignalDataTypeMap[T]>;
      const result: { [id: string]: SignalDataTypeMap[T] } = {};
      for (const id of ids) { if (bucket[id] != null) result[id] = bucket[id]; }
      return Promise.resolve(result);
    },
    set(data: SignalDataSet) {
      for (const [type, vals] of Object.entries(data)) {
        if (!vals) continue;
        if (!keys[type]) keys[type] = {};
        for (const [id, val] of Object.entries(vals)) {
          if (val == null) delete keys[type][id];
          else keys[type][id] = val;
        }
      }
      dirty = true;
      schedule();
      return Promise.resolve();
    },
  };
}

export async function useDatabaseAuthState(sessionId: string): Promise<{
  state: { creds: AuthenticationCreds; keys: ReturnType<typeof makeKeyStore> };
  saveCreds: () => Promise<void>;
  clearSession: () => Promise<void>;
}> {
  const [row] = await db
    .select()
    .from(botSessionsTable)
    .where(eq(botSessionsTable.sessionId, sessionId));

  let creds: AuthenticationCreds;
  let keys: KeyMap;

  if (row?.creds) {
    creds = revive(row.creds) as AuthenticationCreds;
    keys  = row.keys ? (revive(row.keys) as KeyMap) : {};
  } else {
    creds = initAuthCreds();
    keys  = {};
  }

  const keyStore = makeKeyStore(keys, sessionId);

  async function saveCreds(): Promise<void> {
    await upsertCreds(sessionId, toJsonSafe(creds)).catch(() => {});
  }

  async function clearSession(): Promise<void> {
    await db.delete(botSessionsTable).where(eq(botSessionsTable.sessionId, sessionId)).catch(() => {});
  }

  return { state: { creds, keys: keyStore }, saveCreds, clearSession };
}

/** Delete the bot_sessions row for a given session_id. */
export async function clearDatabaseSession(sessionId: string): Promise<void> {
  await db.delete(botSessionsTable).where(eq(botSessionsTable.sessionId, sessionId)).catch(() => {});
}

/** True if Supabase has a session row with credentials for this sessionId. */
export async function hasStoredSession(sessionId: string): Promise<boolean> {
  const [row] = await db
    .select({ creds: botSessionsTable.creds })
    .from(botSessionsTable)
    .where(eq(botSessionsTable.sessionId, sessionId));
  return !!row?.creds;
}
