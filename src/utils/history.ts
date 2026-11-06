import { equalTo, get, orderByChild, query, ref, set } from 'firebase/database';
import { db } from '../firebase';
import type { HistoryItem, PayoutMode, PlayerGroup, RoomEvent, RoomState, UserIdentity } from '../types/app';
import { lastActivity } from './room';

/** Firebase keeps arrays as arrays or as objects keyed by index. */
function list<T>(value: T[] | Record<string, T> | undefined): T[] {
  return Array.isArray(value) ? value : Object.values(value ?? {});
}

/** The history row for a finished room. `winner` defaults to the player in first place. */
export function historyItemFor(room: RoomState, completedAt: number, winner?: string): HistoryItem {
  const players = list(room.players);
  const item: HistoryItem = {
    roomId: room.roomId,
    title: room.title,
    createdAt: room.createdAt,
    completedAt,
    winner: winner ?? players.find((p) => p.id === room.payouts?.firstPlayerId)?.name ?? 'Unknown',
    playerCount: players.length,
    buyIn: room.settings.buyIn,
    bounty: room.settings.bounty,
    payoutMode: room.payouts?.mode as PayoutMode,
    createdBy: room.createdBy?.displayName ?? '',
    players: players.map((p) => p.name),
    users: [...new Set([...list<UserIdentity>(room.users).map((u) => u?.uid), room.createdBy?.uid])]
      .filter((uid): uid is string => !!uid)
      .sort(),
  };
  if (room.settings.currency) item.currency = room.settings.currency;
  return item;
}

/** Rebuilds a missing history row from a finished room: time and winner from its "finished" event. */
function recoveredItem(room: RoomState): HistoryItem {
  const finished = list<RoomEvent>(room.events).find((e) => e?.type === 'tournament_finished');
  const winner = typeof finished?.meta?.winner === 'string' ? finished.meta.winner : undefined;
  return historyItemFor(room, finished?.createdAt ?? lastActivity(room), winner);
}

/**
 * Finished rooms the user was in that have no history row (it was lost when the game ended):
 * writes the rows back. Call once, online, after history has loaded.
 */
export async function recoverMissingHistory(me: UserIdentity, history: HistoryItem[]) {
  const snapshot = await get(query(ref(db, 'rooms'), orderByChild('phase'), equalTo('end')));
  const known = new Set(history.map((item) => item.roomId));
  const rooms = Object.values((snapshot.val() ?? {}) as Record<string, RoomState>);
  const missing = rooms.filter(
    (room) =>
      room?.roomId &&
      !known.has(room.roomId) &&
      (room.createdBy?.uid === me.uid || list<UserIdentity>(room.users).some((u) => u?.uid === me.uid))
  );
  await Promise.all(missing.map((room) => set(ref(db, `history/${room.roomId}`), recoveredItem(room))));
}

const nameKey = (name: string | undefined) => (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Games you were in, and games played by someone in one of your groups (same rule as iOS).
 * Older rows without a player list are matched on the winner and the creator.
 */
export function isVisibleHistory(item: HistoryItem, me: UserIdentity, groups: PlayerGroup[]) {
  const uids = new Set(item.users ?? []);
  const names = new Set([item.winner, item.createdBy, ...(item.players ?? [])].map(nameKey).filter(Boolean));
  if (uids.has(me.uid) || names.has(nameKey(me.displayName))) return true;
  return groups.some((group) =>
    Object.values(group.members ?? {}).some((m) => (m.uid && uids.has(m.uid)) || names.has(nameKey(m.name)))
  );
}
