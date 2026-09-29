import { onAuthStateChanged } from 'firebase/auth';
import { get, ref, update } from 'firebase/database';
import { auth, db } from '../firebase';
import type { HistoryItem, RoomState } from '../types/app';
import { lastActivity } from './room';

// Games with no activity for this long are deleted: room, admin PIN and history entry.
export const SWEEP_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
// Each device sweeps at most once a day.
const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;
const LAST_SWEEP_KEY = 'poker.lastSweep';

function readLastSweep() {
  try {
    return Number(localStorage.getItem(LAST_SWEEP_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeLastSweep(at: number) {
  try {
    localStorage.setItem(LAST_SWEEP_KEY, String(at));
  } catch {
    // Storage blocked: we just sweep again next time.
  }
}

/**
 * Delete games idle for 30+ days. Runs for logged-in users when the app opens.
 * `keepRoomId` (the room open on this device) is never deleted. Returns the deleted room ids.
 */
export async function sweepOldGames(keepRoomId?: string): Promise<string[]> {
  const now = Date.now();
  if (now - readLastSweep() < SWEEP_EVERY_MS) return [];
  writeLastSweep(now);

  const cutoff = now - SWEEP_AFTER_MS;
  const [roomsSnap, historySnap] = await Promise.all([get(ref(db, 'rooms')), get(ref(db, 'history'))]);
  const rooms = (roomsSnap.val() ?? {}) as Record<string, RoomState>;
  const history = (historySnap.val() ?? {}) as Record<string, HistoryItem>;

  const removals: Record<string, null> = {};
  const swept: string[] = [];

  for (const [id, room] of Object.entries(rooms)) {
    if (!room || id === keepRoomId) continue;
    const last = lastActivity(room);
    // No timestamps at all: can't tell its age, leave it alone.
    if (!last || last >= cutoff) continue;
    removals[`rooms/${id}`] = null;
    removals[`roomPins/${id}`] = null;
    removals[`history/${id}`] = null;
    swept.push(id);
  }

  // History rows whose room is already gone.
  for (const [id, item] of Object.entries(history)) {
    if (id === keepRoomId || rooms[id]) continue;
    if (item?.completedAt && item.completedAt < cutoff) removals[`history/${id}`] = null;
  }

  if (Object.keys(removals).length > 0) await update(ref(db), removals);
  return swept;
}

/** Run the sweep whenever a logged-in (non-guest) user is signed in. The room in the address bar is kept. */
export function startOldGameSweep() {
  onAuthStateChanged(auth, (user) => {
    if (!user || user.isAnonymous) return;
    const openRoom = window.location.hash.replace('#room=', '').trim().toUpperCase();
    sweepOldGames(openRoom || undefined).catch((error) => console.warn('old game sweep failed', error));
  });
}
