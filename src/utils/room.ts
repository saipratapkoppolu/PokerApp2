import type {
  AppPage,
  RoomEvent,
  RoomEventType,
  RoomState,
  UserIdentity,
} from '../types/app';
import { randomTournamentName } from './names';
import { DEFAULT_LATE_REG_LEVEL, houseLevels, initialClock, preferredMinutes } from './blinds';

export const SUITS = ['♠', '♥', '♦', '♣'];
export const MAX_PLAYERS = 12;

/** Newest timestamp seen on a room (events, clock, creation); 0 if it has none. */
export function lastActivity(room: RoomState) {
  const events: RoomEvent[] = Array.isArray(room.events) ? room.events : Object.values(room.events ?? {});
  const newestEvent = events.reduce((max, e) => Math.max(max, e?.createdAt ?? 0), 0);
  return Math.max(newestEvent, room.clock?.startedAt ?? 0, room.createdAt ?? 0);
}
export const FINISH_ALLOWED_AT = 5;

export function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export function makeRoomId() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

export function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function derivePage(room: RoomState | null, manualPage: AppPage): AppPage {
  if (!room) return manualPage === 'history' ? 'history' : 'home';
  if (manualPage === 'history') return 'history';
  if (room.phase === 'setup') return 'setup';
  if (room.phase === 'game') return 'live';
  return 'completed';
}

export function defaultRoom(roomId: string, user: UserIdentity): RoomState {
  return {
    phase: 'setup',
    roomId,
    title: randomTournamentName(),
    createdAt: Date.now(),
    createdBy: user,
    currentAdmin: user,
    settings: {
      buyIn: 12,
      bounty: 3,
      adminPin: '',
      pinCreated: false,
      levels: houseLevels(preferredMinutes()),
      lateRegLevel: DEFAULT_LATE_REG_LEVEL,
    },
    clock: initialClock(),
    users: [user],
    players: [],
    events: [],
    payouts: {
  mode: 3,
  first: '',
  second: '',
  third: '',
  fourth: '',
  fifth: '',
  sixth: '',
  firstPlayerId: '',
  secondPlayerId: '',
  thirdPlayerId: '',
  fourthPlayerId: '',
  fifthPlayerId: '',
  sixthPlayerId: '',
},
  };
}

export function eventText(type: RoomEventType, actor: string, meta?: Record<string, unknown>) {
  switch (type) {
    case 'room_created':
      return `${actor} created the room.`;
    case 'user_joined':
      return `${actor} joined the room.`;
    case 'admin_claimed':
      return `${actor} took admin access${meta?.previousAdmin ? ` from ${meta.previousAdmin}` : ''}.`;
    case 'admin_released':
      return `${actor} released admin access.`;
    case 'admin_pin_created':
      return `${actor} created the admin PIN.`;
    case 'admin_pin_changed':
      return `${actor} changed the admin PIN.`;
    case 'player_added':
      return `${actor} added ${meta?.playerName}.`;
    case 'player_removed':
      return `${actor} removed ${meta?.playerName}.`;
    case 'game_started':
      return `${actor} started the tournament.`;
    case 'knockout_recorded':
      return `${actor} recorded knockout: ${meta?.details ?? `${meta?.eliminatedNames} by ${meta?.winnerNames}`}${meta?.winningHand ? ` with ${meta.winningHand}` : ''}.`;
    case 'undo_action':
      return `${actor} undid the last knockout entry.`;
    case 'payouts_updated':
      return `${actor} updated payouts.`;
    case 'tournament_finished':
      return `${actor} finished the tournament.`;
    case 'clock_started':
      return `${actor} started the clock${meta?.level ? ` at ${meta.level}` : ''}.`;
    case 'clock_paused':
      return `${actor} paused the clock${meta?.level ? ` at ${meta.level}` : ''}.`;
    case 'level_changed':
      return `${actor} moved the clock to ${meta?.level}.`;
    case 'blinds_updated':
      return `${actor} updated the blind structure.`;
    case 'buyins_closed':
      return `${actor} closed buy-ins.`;
    case 'title_changed':
      return `${actor} renamed the tournament to "${meta?.title}".`;
    case 'fresh_room_created':
      return `${actor} created fresh room ${meta?.newRoomId} from this tournament.`;
    default:
      return `${actor} updated the room.`;
  }
}

export function createEvent(
  type: RoomEventType,
  actor: UserIdentity,
  meta?: Record<string, unknown>
): RoomEvent {
  // Firebase rejects undefined values (e.g. no previous admin after a release), so drop them.
  if (meta) meta = Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined));
  return {
    id: makeId(),
    type,
    actor: actor.displayName,
    actorId: actor.uid,
    time: nowTime(),
    createdAt: Date.now(),
    text: eventText(type, actor.displayName, meta),
    ...(meta ? { meta } : {}),
  };
}