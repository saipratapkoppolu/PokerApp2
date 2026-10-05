export type Player = {
  id: string;
  name: string;
  buyins: number;
  bountyBalance: number;
  active: boolean;
  suit: string;
};

export type PayoutKey = 'first' | 'second' | 'third' | 'fourth' | 'fifth' | 'sixth';
/** Number of paid places (1–6). */
export type PayoutMode = number;
export type Phase = 'setup' | 'game' | 'end';
export type AppPage = 'auth' | 'home' | 'setup' | 'live' | 'history' | 'completed';
export type AuthMode = 'login' | 'register' | 'reset';

export type WinningHand =
  | 'Royal Flush'
  | 'Straight Flush'
  | 'Four of a Kind'
  | 'Full House'
  | 'Flush'
  | 'Straight'
  | 'Three of a Kind'
  | 'Two Pair'
  | 'One Pair'
  | 'High Card';

export type RoomEventType =
  | 'room_created'
  | 'user_joined'
  | 'admin_claimed'
  | 'admin_released'
  | 'admin_pin_created'
  | 'admin_pin_changed'
  | 'player_added'
  | 'player_removed'
  | 'game_started'
  | 'knockout_recorded'
  | 'undo_action'
  | 'payouts_updated'
  | 'tournament_finished'
  | 'fresh_room_created'
  | 'buyins_closed'
  | 'clock_started'
  | 'clock_paused'
  | 'level_changed'
  | 'blinds_updated'
  | 'title_changed';

/** 'tone:<uid>' = a player's uploaded MP3 (see src/utils/tones.ts). */
export type LevelSound = 'song' | 'fanfare' | 'doot' | `tone:${string}`;

export type BlindLevel = {
  sb: number;
  bb: number;
  ante: number;
  minutes: number;
  isBreak: boolean;
};

/**
 * Shared tournament clock. Every device derives the live level/remaining time
 * from this anchor, so only admin actions (start, pause, skip) write to the DB.
 * Timestamps are in server time (Date.now() + .info/serverTimeOffset).
 */
export type ClockState = {
  running: boolean;
  levelIndex: number;
  levelElapsedMs: number;
  startedAt: number | null;
};

export type RoomEvent = {
  id: string;
  type: RoomEventType;
  actor: string;
  actorId: string;
  time: string;
  createdAt: number;
  text: string;
  meta?: Record<string, unknown>;
};

export type UserProfile = {
  uid: string;
  email: string;
  displayName: string;
  displayNameKey: string;
  createdAt: number;
  active: boolean;
};

export type UserIdentity = {
  uid: string;
  email: string;
  displayName: string;
};

export type HistoryItem = {
  roomId: string;
  sourceRoomId?: string;
  title: string;
  createdAt: number;
  completedAt: number;
  winner: string;
  playerCount: number;
  buyIn: number;
  bounty: number;
  payoutMode: PayoutMode;
  createdBy: string;
};

export type RoomState = {
  phase: Phase;
  roomId: string;
  title: string;
  createdAt: number;
  createdBy: UserIdentity;
  currentAdmin: UserIdentity | null;
  settings: {
    buyIn: number;
    bounty: number;
    adminPin: string;
    pinCreated: boolean;
    buyinsClosed?: boolean;
    levels?: BlindLevel[];
    /** Buy-ins close automatically when this level (1-based, breaks not counted) ends. 0 = manual. */
    lateRegLevel?: number;
    /** What plays after the "Time is up" announcement. Default: 'song'. */
    levelSound?: LevelSound;
  };
  clock?: ClockState;
  users: UserIdentity[];
  players: Player[];
  events: RoomEvent[];
  payouts: {
  mode: PayoutMode;
  first: string;
  second: string;
  third: string;
  fourth: string;
  fifth: string;
  sixth: string;
  firstPlayerId?: string;
  secondPlayerId?: string;
  thirdPlayerId?: string;
  fourthPlayerId?: string;
  fifthPlayerId?: string;
  sixthPlayerId?: string;
  /** Player ids in final finishing order, saved when the game is finished. */
  finalOrder?: string[];
};
  /** Set once the results were added to Splitwise, so nobody adds them twice. */
  splitwise?: { expenseId: number; groupName: string; addedBy: string; addedAt: number };
};

export type UndoState = {
  players: Player[];
  eventIdsToRemove: string[];
  label: string;
  eliminatedNames?: string | string[];
  settings?: Partial<RoomState['settings']>;
} | null;

/** Public, PIN-free summary of a room, listed on the landing page so anyone can watch. */
export type LiveRoomSummary = {
  roomId: string;
  title: string;
  phase: Phase;
  players: number;
  left: number;
  pool: number;
  buyIn: number;
  bounty: number;
  clock: ClockState | null;
  levels: BlindLevel[];
  updatedAt: number;
};
