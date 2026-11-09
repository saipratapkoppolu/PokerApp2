/**
 * Which games an account may see, worked out here because database rules can't filter a list: nobody reads all of
 * history/ or rooms/ any more, only the rows this returns (and single rooms by their code).
 *
 *   GET /visible   (Authorization: Bearer <Firebase ID token>)
 *     → { history: [HistoryItem], live: [roomId] }
 *     history — finished games you played in, or run by you or by an account in one of your groups
 *               (same rule as HistoryVisibility.swift and src/utils/history.ts)
 *     live    — games in progress under the same rule, or that you've opened
 *   cron (daily) — deletes games idle for 30 days (was src/utils/sweep.ts / Sweep.swift on each device) and writes
 *                  back history rows lost when a game ended (was recoverMissingHistory in both apps).
 */

import { json, patch, read, readWhere, verifyIdToken } from './push.js';

const SWEEP_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Firebase keeps arrays as arrays or as objects keyed by index. */
const list = (value) => (Array.isArray(value) ? value : Object.values(value ?? {})).filter(Boolean);
const nameKey = (name) => (typeof name === 'string' ? name : '').trim().replace(/\s+/g, ' ').toLowerCase();

export async function visible(request, env, cors) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET') return json({ error: 'GET only' }, 405, cors);
  const uid = await verifyIdToken((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
  if (!uid) return json({ error: 'Sign in first' }, 401, cors);

  const [profile, groupIds, history, liveRooms] = await Promise.all([
    read(env, `users/${uid}`),
    read(env, `userGroups/${uid}`),
    read(env, 'history'),
    readWhere(env, 'rooms', 'phase', 'game'),
  ]);
  const groups = (await Promise.all(Object.keys(groupIds || {}).map((id) => read(env, `groups/${id}`)))).filter(Boolean);
  // Accounts in your groups (you too), and the names you go by: your display name and your name in each group.
  const accounts = new Set([uid, ...groups.flatMap((g) => list(g.members).map((m) => m.uid).filter(Boolean))]);
  const myNames = new Set([profile?.displayName, ...groups.map((g) => g.members?.[uid]?.name)].map(nameKey).filter(Boolean));
  const played = (names) => names.some((n) => myNames.has(nameKey(n)));

  const items = Object.entries(history || {})
    .filter(([, item]) => item && ((item.createdById && accounts.has(item.createdById)) || played(list(item.players))))
    .map(([roomId, item]) => ({ ...item, roomId }));
  const live = Object.entries(liveRooms || {})
    .filter(
      ([, room]) =>
        room &&
        (accounts.has(room.createdBy?.uid) ||
          list(room.users).some((u) => u.uid === uid) ||
          played(list(room.players).map((p) => p.name)))
    )
    .map(([roomId]) => roomId);
  return json({ history: items, live }, 200, { ...cors, 'Cache-Control': 'no-store' });
}

// ---------------------------------------------------------------- daily upkeep

/** Old games out, lost history rows back. Reads every room once a day. */
export async function upkeep(env) {
  const [rooms, history] = await Promise.all([read(env, 'rooms'), read(env, 'history')]);
  const now = Date.now();
  const cutoff = now - SWEEP_AFTER_MS;
  const removals = {};
  for (const [id, room] of Object.entries(rooms || {})) {
    if (!room) continue;
    const last = lastPlayed(room);
    // No timestamps at all: can't tell its age, leave it alone.
    if (!last || last >= cutoff) continue;
    removals[`rooms/${id}`] = null;
    removals[`roomPins/${id}`] = null;
    removals[`history/${id}`] = null;
  }
  // History rows whose room is already gone.
  for (const [id, item] of Object.entries(history || {})) {
    if (!rooms?.[id] && item?.completedAt && item.completedAt < cutoff) removals[`history/${id}`] = null;
  }
  // Finished games with no history row (it was lost when the game ended).
  const changes = { ...removals };
  for (const [id, room] of Object.entries(rooms || {})) {
    if (!room || room.phase !== 'end' || history?.[id] || `rooms/${id}` in removals) continue;
    changes[`history/${id}`] = recoveredItem({ ...room, roomId: room.roomId || id });
  }
  // One write, however many rows: a worker run may only make a limited number of requests.
  if (Object.keys(changes).length > 0) await patch(env, changes);
}

// Opening a game from History logs "user joined"; that is viewing, not playing, so it doesn't keep a game alive.
function lastPlayed(room) {
  const newest = list(room.events).reduce((max, e) => (e.type !== 'user_joined' ? Math.max(max, e.createdAt ?? 0) : max), 0);
  return Math.max(newest, room.clock?.startedAt ?? 0, room.createdAt ?? 0);
}

function lastActivity(room) {
  const newest = list(room.events).reduce((max, e) => Math.max(max, e.createdAt ?? 0), 0);
  return Math.max(newest, room.clock?.startedAt ?? 0, room.createdAt ?? 0);
}

/** The history row for a finished room, as historyItemFor in src/utils/history.ts: time and winner from its
 *  "finished" event. */
function recoveredItem(room) {
  const finished = list(room.events).find((e) => e.type === 'tournament_finished');
  const players = list(room.players);
  const winner =
    (typeof finished?.meta?.winner === 'string' && finished.meta.winner) ||
    players.find((p) => p.id === room.payouts?.firstPlayerId)?.name ||
    'Unknown';
  const item = {
    roomId: room.roomId,
    title: room.title,
    createdAt: room.createdAt,
    completedAt: finished?.createdAt ?? lastActivity(room),
    winner,
    playerCount: players.length,
    buyIn: room.settings?.buyIn ?? 0,
    bounty: room.settings?.bounty ?? 0,
    createdBy: room.createdBy?.displayName ?? '',
    players: players.map((p) => p.name),
    users: [...new Set([...list(room.users).map((u) => u.uid), room.createdBy?.uid])].filter(Boolean).sort(),
  };
  if (room.payouts?.mode) item.payoutMode = room.payouts.mode;
  if (room.settings?.currency) item.currency = room.settings.currency;
  if (room.createdBy?.uid) item.createdById = room.createdBy.uid;
  return item;
}
