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
  if (room.createdBy?.uid) item.createdById = room.createdBy.uid;
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
 * Games you played in, and games run by you or by an account in one of your groups (the game's creator, its
 * admin); same rule as iOS. Players are names, so "you" is your account name or your name in any of your groups.
 */
export function isVisibleHistory(item: HistoryItem, me: UserIdentity, groups: PlayerGroup[]) {
  const creator = item.createdById;
  if (creator && (creator === me.uid || groups.some((g) => Object.values(g.members ?? {}).some((m) => m.uid === creator)))) {
    return true;
  }
  const myNames = new Set([me.displayName, ...groups.map((g) => g.members?.[me.uid]?.name)].map(nameKey).filter(Boolean));
  return (item.players ?? []).some((p) => myNames.has(nameKey(p)));
}
