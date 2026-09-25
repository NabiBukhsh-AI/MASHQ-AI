import type { TurnEvent } from "@/lib/schemas/turn-events";

interface LockEntry {
  expiresAt: number;
}

interface IdempotentEntry {
  events: TurnEvent[];
  expiresAt: number;
}

const locks = new Map<string, LockEntry>();
const idempotencyCache = new Map<string, IdempotentEntry>();

const LOCK_TTL_MS = 30_000;
const IDEMPOTENCY_TTL_MS = 5 * 60_000;

/**
 * Acquires an exclusive in-memory execution lock for a session turn.
 * Returns false if a turn is currently active for this session.
 */
export async function acquireTurnLock(sessionId: string, ttlMs = LOCK_TTL_MS): Promise<boolean> {
  const now = Date.now();
  const existing = locks.get(sessionId);
  if (existing && existing.expiresAt > now) {
    return false;
  }
  locks.set(sessionId, { expiresAt: now + ttlMs });
  return true;
}

/**
 * Releases the session turn lock.
 */
export async function releaseTurnLock(sessionId: string): Promise<void> {
  locks.delete(sessionId);
}

/**
 * Retrieves cached turn events for a previously completed idempotent request.
 */
export async function getIdempotentTurn(
  sessionId: string,
  key: string,
): Promise<TurnEvent[] | null> {
  const cacheKey = `${sessionId}:${key}`;
  const now = Date.now();
  const entry = idempotencyCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    idempotencyCache.delete(cacheKey);
    return null;
  }
  return entry.events;
}

/**
 * Saves completed turn events keyed by session and client idempotency key.
 */
export async function saveIdempotentTurn(
  sessionId: string,
  key: string,
  events: TurnEvent[],
  ttlMs = IDEMPOTENCY_TTL_MS,
): Promise<void> {
  const cacheKey = `${sessionId}:${key}`;
  idempotencyCache.set(cacheKey, {
    events,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Resets locks and idempotency caches (for tests and cleanups).
 */
export function clearTurnLocks(): void {
  locks.clear();
  idempotencyCache.clear();
}
