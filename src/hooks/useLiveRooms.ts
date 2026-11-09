import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '../firebase';
import { subscribeVisible } from '../utils/visible';
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

/** Tournaments in progress that this account may see (the worker lists them: nobody can list every room), each
 *  followed live. Signed out: none (a game still opens with its code or link). */
export function useLiveRooms() {
  const [rooms, setRooms] = useState<LiveRoomSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const following = new Map<string, () => void>();
    const latest = new Map<string, RoomState>();
    const publish = () => {
      const cutoff = Date.now() - STALE_AFTER_MS;
      setRooms(
        [...latest.values()]
          .filter((room) => room && room.roomId && room.phase === 'game')
          .map(summarize)
          .filter((room) => room.updatedAt > cutoff)
          .sort((a, b) => b.updatedAt - a.updatedAt)
      );
    };
    const stopVisible = subscribeVisible(({ live }) => {
      const ids = new Set(live);
      following.forEach((stop, id) => {
        if (ids.has(id)) return;
        stop();
        following.delete(id);
        latest.delete(id);
      });
      ids.forEach((id) => {
        if (following.has(id)) return;
        following.set(
          id,
          onValue(
            ref(db, `rooms/${id}`),
            (snapshot) => {
              const room = snapshot.val() as RoomState | null;
              if (room) latest.set(id, { ...room, roomId: room.roomId || id });
              else latest.delete(id);
              publish();
            },
            (error) => console.warn('live room read failed', id, error)
          )
        );
      });
      publish();
      setLoading(false);
    });
    return () => {
      stopVisible();
      following.forEach((stop) => stop());
    };
  }, []);

  const [now, setNow] = useState(() => Date.now());
  const anyRunning = rooms.some((room) => room.clock?.running);
  useEffect(() => {
    if (!anyRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyRunning]);

  return { rooms, loading, now };
}
