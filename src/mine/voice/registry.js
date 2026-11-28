import { createHash, timingSafeEqual } from "node:crypto";
import { MAX_CONCURRENT_CALLS } from "./constants.js";

// In-memory registry, kept on globalThis so Next dev module reloads share it.
// A process restart forgets all calls (documented limitation).
const STATE = Symbol.for("9router.mine.voice.live.registry");
function state() {
  globalThis[STATE] ??= { calls: new Map(), reserved: 0 };
  return globalThis[STATE];
}

export function hashKey(key) {
  return createHash("sha256").update(String(key)).digest();
}

// Constant-time comparison of the calling key hash with the creator's hash.
export function ownsCall(entry, key) {
  const other = hashKey(key);
  return other.length === entry.keyHash.length && timingSafeEqual(other, entry.keyHash);
}

export function getCall(id) {
  return state().calls.get(id) || null;
}

// Synchronous check-and-reserve: pending creations count against the limit.
export function reserveSlot() {
  const s = state();
  if (s.calls.size + s.reserved >= MAX_CONCURRENT_CALLS) return null;
  s.reserved += 1;
  let settled = false;
  return {
    commit(entry) {
      if (settled) return false;
      settled = true;
      s.reserved -= 1;
      if (s.calls.has(entry.id)) return false;
      s.calls.set(entry.id, entry);
      return true;
    },
    release() {
      if (settled) return;
      settled = true;
      s.reserved -= 1;
    },
  };
}

// Identity-checked removal: a stale timer can never free another call's slot.
export function removeCall(entry) {
  const s = state();
  if (s.calls.get(entry.id) !== entry) return false;
  s.calls.delete(entry.id);
  clearTimeout(entry.timer);
  return true;
}

// Test-only: drop every entry and pending reservation.
export function resetRegistryForTests() {
  const s = state();
  for (const entry of s.calls.values()) clearTimeout(entry.timer);
  s.calls.clear();
  s.reserved = 0;
}
