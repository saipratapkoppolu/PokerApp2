export type Player = {
  id: string;
  name: string;
  buyins: number;
  bountyBalance: number;
  active: boolean;
  suit: string;
  /** The admin took them out of a running tournament: out like a bust, no buy-in again. Absent = not kicked. */
  kicked?: boolean;
};

export type PayoutKey = 'first' | 'second' | 'third' | 'fourth' | 'fifth' | 'sixth';
/** Number of paid places (1–6). */
export type PayoutMode = number;
export type Phase = 'setup' | 'game' | 'end';
export type AppPage = 'auth' | 'home' | 'setup' | 'live' | 'history' | 'groups' | 'completed' | 'profile' | 'settings';
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
  | 'player_kicked'
  | 'game_started'
  | 'knockout_recorded'
  | 'undo_action'
  | 'payouts_updated'
  | 'tournament_finished'
  | 'fresh_room_created'
  | 'buyins_closed'
  | 'buyins_reopened'
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

/** users/{uid}: readable by every signed-in user, so no email (that stays in Firebase Auth). */
export type UserProfile = {
  uid: string;
  displayName: string;
  displayNameKey: string;
  createdAt: number;
  active: boolean;
  /** A short line under the name ("Free Fridays"). */
  status?: string;
  /** When the profile picture (avatars/{uid}) last changed. */
  photoUpdatedAt?: number;
};

/** Who did something. Written into rooms, which anyone with the room code can read: no email. */
export type UserIdentity = {
  uid: string;
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
  /** ISO currency code, written by the iOS app; missing means euro. */
  currency?: string;
  /** Who played, and the accounts in the room: the game shows only to them and their groups. */
  players?: string[];
  users?: string[];
  /** The account that created (and ran) the game: whose groups see it. */
  createdById?: string;
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
    /** ISO currency code, set by the iOS app; missing means euro. */
    currency?: string;
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
  /** Tip taken out of the prize pool (euros, as typed). */
  tip?: string;
  /** Who gets the tip: a Splitwise group member and/or a player in this game. */
  tipTo?: TipRecipient;
};
  /** Set once the results were added to Splitwise, so nobody adds them twice. */
  /** The game's Splitwise expense; null clears it (Undo). */
  splitwise?: { expenseId: number; groupName: string; addedBy: string; addedAt: number } | null;
};

export type TipRecipient = { name: string; splitwiseId?: number; playerId?: string };

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

/**
 * A group of players (like a WhatsApp group). Account members are keyed by their uid; name-only
 * members (no account) by `n_<id>`. Only account members can be admins.
 */
export type GroupMember = {
  name: string;
  /** Set for app accounts (equals the member's key). */
  uid?: string;
  addedAt: number;
};

export type PlayerGroup = {
  id: string;
  name: string;
  createdAt: number;
  createdBy: UserIdentity;
  members: Record<string, GroupMember>;
  admins: Record<string, true>;
};

/** An answer to a "Who's in?" poll: in from the start, out, or buying in after the start. */
export type PollAnswer = 'in' | 'out' | 'buyin';

/** One member's answer, keyed by their group member key (uid, or n_… for a name without an account). */
export type PollVote = {
  answer: PollAnswer;
  name: string;
  at: number;
};

/** groupPolls/{groupId}/{pollId}: "Who's in?" for a game at a set time, posted by a group admin. */
export type GamePoll = {
  id: string;
  groupId: string;
  title: string;
  startsAt: number;
  createdAt: number;
  createdBy: { uid: string; displayName: string };
  votes?: Record<string, PollVote>;
  /** The game started from it. */
  roomId?: string;
};
