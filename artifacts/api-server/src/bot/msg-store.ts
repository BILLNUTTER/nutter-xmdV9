/**
 * In-memory message store — replaces DB for antidelete and view-once.
 * No persistence across restarts (by design). Auto-expires entries.
 */
import { proto } from "@whiskeysockets/baileys";

const ANTIDELETE_TTL = 10 * 60 * 1000; // 10 minutes
const VIEWONCE_TTL   =  5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES    = 5_000;

interface Entry {
  msg: proto.IWebMessageInfo;
  storedAt: number;
}

// Separate store per bot (keyed by userId → messageId → entry)
const antideleteStore = new Map<string, Map<string, Entry>>();
const viewonceStore   = new Map<string, Map<string, Entry>>();

function getOrCreate(outer: Map<string, Map<string, Entry>>, userId: string) {
  let m = outer.get(userId);
  if (!m) { m = new Map(); outer.set(userId, m); }
  return m;
}

function evict(store: Map<string, Entry>, ttl: number): void {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (now - entry.storedAt > ttl) store.delete(id);
  }
  // Hard cap
  if (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
}

// ---------- Antidelete ----------

export function storeForAntidelete(userId: string, msg: proto.IWebMessageInfo): void {
  const msgId = msg.key.id;
  if (!msgId) return;
  const store = getOrCreate(antideleteStore, userId);
  evict(store, ANTIDELETE_TTL);
  store.set(msgId, { msg, storedAt: Date.now() });
}

export function popAntidelete(
  userId: string,
  msgId: string
): proto.IWebMessageInfo | null {
  const store = antideleteStore.get(userId);
  if (!store) return null;
  const entry = store.get(msgId);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > ANTIDELETE_TTL) {
    store.delete(msgId);
    return null;
  }
  store.delete(msgId); // forward once, then discard
  return entry.msg;
}

// ---------- View-once ----------

export function storeViewOnce(userId: string, msg: proto.IWebMessageInfo): void {
  const msgId = msg.key.id;
  if (!msgId) return;
  const store = getOrCreate(viewonceStore, userId);
  evict(store, VIEWONCE_TTL);
  store.set(msgId, { msg, storedAt: Date.now() });
}

export function getViewOnce(
  userId: string,
  msgId: string
): { msg: proto.IWebMessageInfo; age: number } | null {
  const store = viewonceStore.get(userId);
  if (!store) return null;
  const entry = store.get(msgId);
  if (!entry) return null;
  const age = Date.now() - entry.storedAt;
  if (age > VIEWONCE_TTL) {
    store.delete(msgId);
    return null;
  }
  return { msg: entry.msg, age };
}
