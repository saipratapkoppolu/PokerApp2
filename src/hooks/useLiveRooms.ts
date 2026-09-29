import { useEffect, useState } from 'react';
import { equalTo, onValue, orderByChild, query, ref } from 'firebase/database';
import { signInAnonymously } from 'firebase/auth';
import { auth, db } from '../firebase';
import type { LiveRoomSummary, Player, RoomState } from '../types/app';
import { normalizeLevels } from '../utils/blinds';
import { lastActivity } from '../utils/room';

// Games with no activity for this long are treated as abandoned (never finished).
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

function summarize(room: RoomState): LiveRoomSummary {
  const players: Player[] = Array.isArray(room.players) ? room.players : Object.values(room.players ?? {});
  const buyIn = room.settings?.buyIn ?? 0;
  return {
    roomId: room.roomId,
    title: room.title,
    phase: room.phase,
    players: players.length,
    left: players.filter((p) => p.active).length,
    pool: players.reduce((sum, p) => sum + (p.buyins ?? 0) * buyIn, 0),
    buyIn,
    bounty: room.settings?.bounty ?? 0,
    clock: room.clock ?? null,
    levels: normalizeLevels(room.settings?.levels),
    updatedAt: lastActivity(room),
  };
}

/** Tournaments in progress right now, read straight from rooms — no account or room code needed. */
export function useLiveRooms() {
  const [rooms, setRooms] = useState<LiveRoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [authVersion, setAuthVersion] = useState(0);

  useEffect(() => {
    const liveQuery = query(ref(db, 'rooms'), orderByChild('phase'), equalTo('game'));
    return onValue(
      liveQuery,
      (snapshot) => {
        const value = (snapshot.val() ?? {}) as Record<string, RoomState>;
        const cutoff = Date.now() - STALE_AFTER_MS;
        const list = Object.values(value)
          .filter((room) => room && room.roomId)
          .map(summarize)
          .filter((room) => room.updatedAt > cutoff)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        setRooms(list);
        setLoading(false);
      },
      async (error) => {
        // Rules may require a signed-in user: retry once as an anonymous guest.
        if (attempt === 0 && !auth.currentUser) {
          try {
            await signInAnonymously(auth);
            setAttempt(1);
            return;
          } catch (signInError) {
            console.warn('Anonymous sign-in unavailable', signInError);
          }
        }
        console.error('live rooms read failed', error);
        setLoading(false);
      }
    );
  }, [attempt, authVersion]);

  // Re-read when someone logs in or out (their read permission changes).
  useEffect(() => auth.onAuthStateChanged(() => setAuthVersion((n) => n + 1)), []);

  const [now, setNow] = useState(() => Date.now());
  const anyRunning = rooms.some((room) => room.clock?.running);
  useEffect(() => {
    if (!anyRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyRunning]);

  return { rooms, loading, now };
}
