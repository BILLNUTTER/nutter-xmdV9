/**
 * useDatabaseAuthState — a Baileys auth state backed by PostgreSQL.
 *
 * Replaces useMultiFileAuthState (filesystem) so WhatsApp sessions survive
 * Heroku dyno restarts and work safely with Supabase session pooler.
 *
 * Each bot gets one row in `bot_sessions`:
 *   creds  JSONB — AuthenticationCreds (registration keys, identity, etc.)
 *   keys   JSONB — Signal protocol key store (pre-keys, sessions, sender-keys…)
 *
 * Buffers are serialised to { type:"Buffer", data:[…] } via BufferJSON so that
 * they survive the JSON round-trip through JSONB.
 */

import {
  initAuthCreds,
  useMultiFileAuthState,
  BufferJSON,
  type AuthenticationCreds,
  type SignalDataTypeMap,
  type SignalDataSet,
} from "@whiskeysockets/baileys";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { db } from "@workspace/db";
import { botSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const FS_AUTH_DIR = join(process.cwd(), "sessions");

type KeyMap = Record<string, Record<string, unknown>>;

// ── Buffer helpers ───────────────────────────────────────────────────────────

function toJsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}

function reviveBuffers(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(reviveBuffers);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (
      (obj["type"] === "Buffer" || obj["buffer"] === true) &&
      Array.isArray(obj["data"])
    ) {
      return Buffer.from(obj["data"] as number[]);
    }
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, reviveBuffers(v)])
    );
  }
  return value;
}

// ── DB persistence ───────────────────────────────────────────────────────────

async function upsertSession(
  botId: string,
  creds: unknown,
  keys: unknown
): Promise<void> {
  await db
    .insert(botSessionsTable)
    .values({
      botId,
      creds: creds as Record<string, unknown>,
      keys: keys as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: botSessionsTable.botId,
      set: {
        creds: creds as Record<string, unknown>,
        keys: keys as Record<string, unknown>,
        updatedAt: new Date(),
      },
    });
}

async function upsertCreds(botId: string, creds: unknown): Promise<void> {
  await db
    .insert(botSessionsTable)
    .values({
      botId,
      creds: creds as Record<string, unknown>,
      keys: {} as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: botSessionsTable.botId,
      set: {
        creds: creds as Record<string, unknown>,
        updatedAt: new Date(),
      },
    });
}

async function upsertKeys(botId: string, keys: unknown): Promise<void> {
  await db
    .insert(botSessionsTable)
    .values({
      botId,
      creds: null,
      keys: keys as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: botSessionsTable.botId,
      set: {
        keys: keys as Record<string, unknown>,
        updatedAt: new Date(),
      },
    });
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function useDatabaseAuthState(botId: string): Promise<{
  state: { creds: AuthenticationCreds; keys: ReturnType<typeof makeKeyStore> };
  saveCreds: () => Promise<void>;
  clearSession: () => Promise<void>;
}> {
  // Load existing row
  const [row] = await db
    .select()
    .from(botSessionsTable)
    .where(eq(botSessionsTable.botId, botId));

  let creds: AuthenticationCreds;
  let keys: KeyMap;

  if (row?.creds) {
    // ── DB session exists — restore from DB ──────────────────────────────────
    creds = reviveBuffers(row.creds) as AuthenticationCreds;
    keys  = row.keys ? (reviveBuffers(row.keys) as KeyMap) : {};
  } else {
    // ── No DB session — check for legacy filesystem session and migrate ───────
    const fsDir = join(FS_AUTH_DIR, botId);
    const fsCredsPath = join(fsDir, "creds.json");

    if (existsSync(fsCredsPath)) {
      // Load from filesystem using Baileys' own reader (handles all key files)
      if (!existsSync(fsDir)) mkdirSync(fsDir, { recursive: true });
      const { state: fsState } = await useMultiFileAuthState(fsDir);
      creds = fsState.creds;

      // Collect all keys from the in-memory key store by reading each known type
      // We can't enumerate types easily, so we seed keys as empty; they will be
      // filled incrementally as Baileys calls keys.set() during reconnect.
      keys = {};

      // Persist migrated creds to DB immediately so future restores use DB
      await upsertSession(botId, toJsonSafe(creds), keys).catch(() => {});
    } else {
      // Fresh session — no credentials stored anywhere yet
      creds = initAuthCreds();
      keys  = {};
    }
  }

  // Debounced key persistence — avoid hammering the DB on every Signal ratchet
  let keysDirty = false;
  let keysSaveTimer: NodeJS.Timeout | null = null;

  function scheduleKeySave() {
    if (keysSaveTimer) clearTimeout(keysSaveTimer);
    keysSaveTimer = setTimeout(async () => {
      keysSaveTimer = null;
      if (!keysDirty) return;
      keysDirty = false;
      await upsertKeys(botId, toJsonSafe(keys)).catch(() => {});
    }, 1_500);
  }

  function makeKeyStore() {
    return {
      get<T extends keyof SignalDataTypeMap>(
        type: T,
        ids: string[]
      ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
        const bucket = (keys[type as string] ?? {}) as Record<
          string,
          SignalDataTypeMap[T]
        >;
        const result: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          if (bucket[id] != null) result[id] = bucket[id];
        }
        return Promise.resolve(result);
      },

      set(data: SignalDataSet): Promise<void> {
        for (const [type, vals] of Object.entries(data)) {
          if (!vals) continue;
          if (!keys[type]) keys[type] = {};
          for (const [id, val] of Object.entries(vals)) {
            if (val == null) {
              delete keys[type][id];
            } else {
              keys[type][id] = val;
            }
          }
        }
        keysDirty = true;
        scheduleKeySave();
        return Promise.resolve();
      },
    };
  }

  const state = { creds, keys: makeKeyStore() };

  async function saveCreds(): Promise<void> {
    // Always flush creds immediately; keys follow on their debounce schedule
    await upsertCreds(botId, toJsonSafe(creds)).catch(() => {});
  }

  async function clearSession(): Promise<void> {
    if (keysSaveTimer) { clearTimeout(keysSaveTimer); keysSaveTimer = null; }
    await db
      .delete(botSessionsTable)
      .where(eq(botSessionsTable.botId, botId))
      .catch(() => {});
  }

  return { state, saveCreds, clearSession };
}

/** Returns true if a DB session row exists for this bot (creds are not null). */
export async function hasStoredSession(botId: string): Promise<boolean> {
  const [row] = await db
    .select({ creds: botSessionsTable.creds })
    .from(botSessionsTable)
    .where(eq(botSessionsTable.botId, botId));
  return !!row?.creds;
}
