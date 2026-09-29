import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  ChevronRight,
  Copy,
  Dices,
  Eye,
  LogIn,
  DoorOpen,
  Flag,
  Pause,
  Play,
  History as HistoryIcon,
  KeyRound,
  Lock,
  LogOut,
  ScrollText,
  Settings2,
  Share2,
  Skull,
  Spade,
  Trophy,
  Undo2,
  Unlock,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { get, onValue, ref, set, update } from 'firebase/database';
import { auth, db } from './firebase';

import type {
  Player,
  PayoutKey,
  PayoutMode,
  AppPage,
  AuthMode,
  WinningHand,
  UserProfile,
  UserIdentity,
  HistoryItem,
  RoomState,
  UndoState,
  BlindLevel,
  ClockState,
  LevelSound,
} from './types/app';
import TournamentClock from './components/TournamentClock';
import BlindStructureEditor from './components/BlindStructureEditor';
import NumberField from './components/NumberField';
import MinutesPicker from './components/MinutesPicker';
import ToneUploader from './components/ToneUploader';
import { useToneIndex } from './hooks/useTones';
import { toneSound, toneUidOf } from './utils/tones';
import ThemePicker from './components/ThemePicker';
import { MAX_PLACES, PAYOUT_SPLITS, defaultPlaces, splitPool } from './utils/payouts';
import { canAddToSplitwise, splitwiseRows } from './utils/splitwise';
import SplitwiseCard from './components/SplitwiseCard';
import { useAlertsPreference, useTournamentClock } from './hooks/useTournamentClock';
import { useLiveRooms } from './hooks/useLiveRooms';
import { blindsLabel, chips, computeClock, formatClock, levelIndexForNumber, normalizeLevels, rememberMinutes } from './utils/blinds';
import { randomTournamentName } from './utils/names';
import { playSound, requestNotificationPermission, showSystemNotification, stopSong, unlockAudio, vibrate } from './utils/alerts';

import {
  fmt,
  normalizeName,
  makeNameKey,
  sameName,
} from './utils/format';

import {
  SUITS,
  MAX_PLAYERS,
  FINISH_ALLOWED_AT,
  makeId,
  makeRoomId,
  defaultRoom,
  createEvent,
} from './utils/room';

const PAYOUT_KEYS: PayoutKey[] = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
const WINNING_HANDS: WinningHand[] = [
  'Royal Flush',
  'Straight Flush',
  'Four of a Kind',
  'Full House',
  'Flush',
  'Straight',
  'Three of a Kind',
  'Two Pair',
  'One Pair',
  'High Card',
];
const PLACE_META: Record<PayoutKey, { label: string; emoji: string }> = {
  first: { label: 'First', emoji: '🥇' },
  second: { label: 'Second', emoji: '🥈' },
  third: { label: 'Third', emoji: '🥉' },
  fourth: { label: 'Fourth', emoji: '4️⃣' },
  fifth: { label: 'Fifth', emoji: '5️⃣' },
  sixth: { label: 'Sixth', emoji: '6️⃣' },
};



type RoomTab = 'table' | 'log' | 'history' | 'room';

function readHashRoom() {
  return window.location.hash.replace('#room=', '').trim().toUpperCase();
}

function Badge({ label, value, tone }: { label: string; value: string; tone?: 'gold' | 'red' | 'green' }) {
  return (
    <div className="badge-box">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function placeIcon(index: number) {
  return index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`;
}

export default function App() {
  const [page, setPage] = useState<AppPage>('auth');
  const [roomTab, setRoomTab] = useState<RoomTab>('table');
  // Guests can watch a room without an account; this flips them to the login screen.
  const [showLogin, setShowLogin] = useState(false);
  const [roomError, setRoomError] = useState('');
  const { rooms: liveRooms, loading: liveLoading, now: liveNow } = useLiveRooms();
  const toneList = useToneIndex();
  const [alertsEnabled, setAlertsEnabled] = useAlertsPreference();
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const [authBooting, setAuthBooting] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState('');

  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');

  const [roomIdInput, setRoomIdInput] = useState('');
  const [roomId, setRoomId] = useState('');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [loadingRoom, setLoadingRoom] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [registeredUsers, setRegisteredUsers] = useState<UserProfile[]>([]);
  const [selectedRegisteredUserIds, setSelectedRegisteredUserIds] = useState<string[]>([]);

  const [nameInput, setNameInput] = useState('');

  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [accessPinInput, setAccessPinInput] = useState('');
  const [, setShowAccessBox] = useState(false);
  const [showChangePinBox, setShowChangePinBox] = useState(false);
  const [newPinInput, setNewPinInput] = useState('');
  const [adminMessage, setAdminMessage] = useState('');

  const [needsPinSetup, setNeedsPinSetup] = useState(false);
  const [setupPinInput, setSetupPinInput] = useState('');
  const [setupPinConfirmInput, setSetupPinConfirmInput] = useState('');
  const [setupPinError, setSetupPinError] = useState('');

  const [elimModal, setElimModal] = useState(false);
  // Knockout form steps: -1 = who's out, 0..n-1 = who took busted player n's bounty, 'hand' = finish.
  const [koStep, setKoStep] = useState<number | 'hand'>(-1);
  const [isRecordingKnockout, setIsRecordingKnockout] = useState(false);
  const [knockoutError, setKnockoutError] = useState('');
  const [selectedEliminatedIds, setSelectedEliminatedIds] = useState<string[]>([]);
  // For each busted player: who took their bounty (several ids = that bounty is split).
  const [bustedBy, setBustedBy] = useState<Record<string, string[]>>({});
  // Rebuy is ticked by default for every busted player while buy-ins are open; false = admin unticked it.
  const [rebuyMap, setRebuyMap] = useState<Record<string, boolean>>({});
  const wantsRebuy = (id: string) => !buyinsClosed && rebuyMap[id] !== false;
  const [winningHand, setWinningHand] = useState<WinningHand | ''>('');

  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoState[]>([]);

  const [finishers, setFinishers] = useState<Record<PayoutKey, string>>({
  first: '',
  second: '',
  third: '',
  fourth: '',
  fifth: '',
  sixth: '',
});

  useEffect(() => {
  const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
    try {
      if (!firebaseUser || firebaseUser.isAnonymous) {
        // Signed out, or an anonymous spectator: no profile, read-only view of the linked room.
        setIdentity(null);
        setPage('auth');
        const hashRoom = readHashRoom();
        if (hashRoom) {
          setRoomId(hashRoom);
          if (!firebaseUser) void watchRoom(hashRoom);
        } else {
          setRoom(null);
          setRoomId('');
        }
        return;
      }

      const snapshot = await get(ref(db, `users/${firebaseUser.uid}`));

      if (snapshot.exists()) {
        setIdentity(snapshot.val() as UserIdentity);
      } else {
        const displayName =
          firebaseUser.displayName ||
          firebaseUser.email?.split('@')[0] ||
          'Player';

        const fallbackProfile: UserProfile = {
          uid: firebaseUser.uid,
          email: firebaseUser.email ?? '',
          displayName,
          displayNameKey: makeNameKey(displayName),
          createdAt: Date.now(),
          active: true,
        };

        await set(ref(db, `users/${firebaseUser.uid}`), fallbackProfile);

        setIdentity({
          uid: fallbackProfile.uid,
          email: fallbackProfile.email,
          displayName: fallbackProfile.displayName,
        });
        }
      
    } finally {
      setAuthBooting(false);
    }
  });

  return () => unsubAuth();
}, []);

  useEffect(() => {
    const unsubscribe = onValue(ref(db, 'history'), (snapshot) => {
      const value = snapshot.val() ?? {};
      const items = Object.values(value) as HistoryItem[];
      items.sort((a, b) => b.completedAt - a.completedAt);
      setHistory(items);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
  if (!identity) return;

  const usersRef = ref(db, 'users');

  const unsubscribe = onValue(
    usersRef,
    (snapshot) => {
    
      const value = snapshot.val() ?? {};
      const items = Object.values(value) as UserProfile[];
      items.sort((a, b) => a.displayName.localeCompare(b.displayName));
      setRegisteredUsers(items.filter((item) => item.active !== false));
    },
    (error) => {
      console.error('users read failed', error);
    }
  );

  return () => unsubscribe();
}, [identity]);

  useEffect(() => {
    if (!identity) return;
    setShowLogin(false);
    const hashRoom = readHashRoom();
    if (hashRoom) {
      joinRoom(hashRoom);
    } else {
      setPage('home');
    }
  }, [identity]);

  useEffect(() => {
    if (!roomId) return;
    const roomRef = ref(db, `rooms/${roomId}`);
    setRoomError('');
    const unsubscribe = onValue(
      roomRef,
      (snapshot) => {
        const data = snapshot.val();
        setRoom(data ?? null);
        setLoadingRoom(false);
        if (!data) setRoomError(`Room ${roomId} was not found.`);
      },
      (error) => {
        console.error('room read failed', error);
        setRoom(null);
        setLoadingRoom(false);
        setRoomError('This room can only be viewed after logging in.');
      }
    );
    return () => unsubscribe();
  }, [roomId]);

  const players = room?.players ?? [];
  const phase = room?.phase ?? 'setup';
  const buyIn = room?.settings.buyIn ?? 12;
  const bounty = room?.settings.bounty ?? 3;
  const adminPin = room?.settings.adminPin ?? '';
  const pinCreated = room?.settings.pinCreated ?? false;
  const buyinsClosedFlag = room?.settings.buyinsClosed ?? false;
  const payoutMode = Math.min(6, Math.max(1, Number(room?.payouts.mode) || 3));
  const payouts = room?.payouts ?? {
    mode: 3 as PayoutMode,
    first: '',
    second: '',
    third: '',
    fourth: '',
    fifth: '',
    sixth: '',
  };
  const events = room?.events ?? [];
  const levels = useMemo(() => normalizeLevels(room?.settings.levels), [room?.settings.levels]);
  // Level number (ignoring breaks) after which buy-ins close automatically; 0 = manual only.
  const lateRegLevel = room?.settings.lateRegLevel ?? 0;
  const lateRegIndex = lateRegLevel > 0 ? levelIndexForNumber(levels, lateRegLevel) : -1;

  const { view: clockView, serverNow, previewAlert } = useTournamentClock({
    clock: room?.clock,
    levels,
    active: phase === 'game',
    alertsEnabled,
    roomTitle: room?.title ?? 'Poker',
    levelSound: room?.settings.levelSound ?? 'song',
    onNotice: setAdminMessage,
  });

  // Buy-ins only close when the admin closes them. After the reminder level the admin gets a nudge.
  const lateRegPassed = phase === 'game' && lateRegIndex >= 0 && clockView.levelIndex > lateRegIndex;
  const buyinsClosed = buyinsClosedFlag;

  // Browsers need a tap before audio can play; re-arm after a reload when alerts were left on.
  useEffect(() => {
    if (!alertsEnabled) return;
    const arm = () => void unlockAudio();
    window.addEventListener('pointerdown', arm, { once: true });
    return () => window.removeEventListener('pointerdown', arm);
  }, [alertsEnabled]);

  // Admin access follows the room: if this account is the room's current admin, stay unlocked
  // after a refresh; if someone else took admin, lock this phone.
  const currentAdminUid = room?.currentAdmin?.uid ?? null;
  useEffect(() => {
    if (!identity || !roomId) return;
    if (currentAdminUid === identity.uid) setIsAdminUnlocked(true);
    else if (currentAdminUid) setIsAdminUnlocked(false);
  }, [currentAdminUid, identity, roomId]);

  // Knockouts (and undos) are announced on every phone, including spectators.
  const lastEventIdRef = useRef<string | null>(null);
  const latestEventId = events[0]?.id ?? null;
  useEffect(() => {
    lastEventIdRef.current = null;
  }, [roomId]);
  useEffect(() => {
    if (!latestEventId) return;
    const previous = lastEventIdRef.current;
    lastEventIdRef.current = latestEventId;
    // First load of a room: don't replay old knockouts.
    if (previous === null || previous === latestEventId) return;
    const seen = events.findIndex((e) => e.id === previous);
    const fresh = (seen === -1 ? events.slice(0, 1) : events.slice(0, seen)).reverse();
    fresh.forEach((event) => {
      if (event.type === 'undo_action') {
        setAdminMessage('↩ Admin undid the last action');
        return;
      }
      if (event.type !== 'knockout_recorded') return;
      const meta = (event.meta ?? {}) as { details?: string; eliminatedNames?: string; winnerNames?: string; bountyText?: string; rebuys?: string[] };
      const details = (meta.details ?? `${meta.eliminatedNames} by ${meta.winnerNames}`).replace(/; /g, ' · ');
      const rebuys = meta.rebuys?.length ? ` · ${meta.rebuys.join(', ')} ${meta.rebuys.length === 1 ? 'rebuys' : 'rebuy'}` : '';
      const message = `💀 Knockout: ${details}${meta.bountyText ? ` · ${meta.bountyText}` : ''}${rebuys}`;
      setAdminMessage(message);
      // Notification only (no sound) when the app is in the background.
      if (alertsEnabled && document.visibilityState === 'hidden') void showSystemNotification('💀 Knockout', message.replace('💀 Knockout: ', ''));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestEventId]);

  // Admin messages show as a toast wherever you are in the app.
  useEffect(() => {
    if (!adminMessage) return;
    const id = window.setTimeout(() => setAdminMessage(''), Math.min(9000, 4000 + adminMessage.length * 40));
    return () => window.clearTimeout(id);
  }, [adminMessage]);

  function payoutKeyForIndex(index: number): PayoutKey | null {
  if (index === 0) return 'first';
  if (index === 1) return 'second';
  if (index === 2) return 'third';
  if (index === 3) return 'fourth';
  if (index === 4) return 'fifth';
  if (index === 5) return 'sixth';
  return null;
}
  

  const activePlayers = useMemo(() => players.filter((p) => p.active), [players]);
  const prizePool = useMemo(() => players.reduce((sum, p) => sum + p.buyins * buyIn, 0), [players, buyIn]);
  const totalBountyPot = useMemo(() => players.filter((p) => p.bountyBalance > 0).reduce((sum, p) => sum + p.bountyBalance, 0),[players]); 
  const sortedForEnd = [...players].sort((a, b) => Number(b.active) - Number(a.active) || b.bountyBalance - a.bountyBalance);
  const selectedFinisherIds = [
  payouts.firstPlayerId,
  payouts.secondPlayerId,
  payouts.thirdPlayerId,
  payouts.fourthPlayerId,
  payouts.fifthPlayerId,
  payouts.sixthPlayerId,
].filter(Boolean) as string[];

const selectedFinishers = selectedFinisherIds
  .map((id) => players.find((p) => p.id === id))
  .filter(Boolean) as Player[];

const remainingPlayers = sortedForEnd.filter(
  (p) => !selectedFinisherIds.includes(p.id)
);

const finalStandings =
  selectedFinishers.length > 0
    ? [...selectedFinishers, ...remainingPlayers]
    : sortedForEnd;
  const distributed = PAYOUT_KEYS.slice(0, payoutMode).reduce((sum, key) => sum + (Number(payouts[key]) || 0), 0);
  const remaining = prizePool - distributed;

  // Spent / earned per player for the Splitwise expense (results page).
  const splitRows = splitwiseRows(finalStandings, buyIn, (id) => {
    const index = finalStandings.findIndex((p) => p.id === id);
    const key = payoutKeyForIndex(index);
    return key && index < payoutMode ? Number(payouts[key]) || 0 : 0;
  });

  const shareLink = roomId ? `${window.location.origin}${window.location.pathname}#room=${roomId}` : '';
  const selectedRegisteredUsers = registeredUsers.filter((user) => selectedRegisteredUserIds.includes(user.uid));


  function clearAuthInputs() {
    setEmailInput('');
    setPasswordInput('');
    setConfirmPasswordInput('');
    setDisplayNameInput('');
  }

  async function patchRoom(next: Partial<RoomState>) {
    if (!roomId) return;
    try {
      await update(ref(db, `rooms/${roomId}`), next as never);
    } catch (error) {
      const code = (error as { code?: string })?.code ?? '';
      console.error('Room update failed', error);
      setAdminMessage(
        code.toUpperCase().includes('PERMISSION')
          ? 'Save blocked by Firebase database rules (permission denied).'
          : `Could not save: ${(error as Error)?.message ?? 'unknown error'}`
      );
      throw error;
    }
  }

  async function registerAccount() {
    const email = emailInput.trim().toLowerCase();
    const password = passwordInput;
    const confirm = confirmPasswordInput;
    const displayName = normalizeName(displayNameInput);
    const displayNameKey = makeNameKey (displayName);

    if (!email || !password || !confirm || !displayName) {
      setAuthMessage('Please complete all registration fields.');
      return;
    }

    if (password.length < 8) {
      setAuthMessage('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirm) {
      setAuthMessage('Passwords do not match.');
      return;
    }

    if (displayName.length < 2) {
      setAuthMessage('Display name must be at least 2 characters.');
      return;
    }

    setAuthLoading(true);
    setAuthMessage('');

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await cred.user.getIdToken(true);

      const profile: UserProfile = {
        uid: cred.user.uid,
        email,
        displayName,
        displayNameKey,
        createdAt: Date.now(),
        active: true,
      };

      await set(ref(db, `users/${cred.user.uid}`), profile);

      clearAuthInputs();
      setAuthMode('login');
      setAuthMessage('Account created successfully. Please log in.');
    } catch (error: any) {
      console.error('registerAccount error', error);
      setAuthMessage(`${error?.code ?? 'unknown-error'}: ${error?.message ?? 'Registration failed.'}`);
    } finally {
      setAuthLoading(false);
    }
  }

  async function loginAccount() {
    const email = emailInput.trim().toLowerCase();
    const password = passwordInput;
    if (!email || !password) {
      setAuthMessage('Enter email and password.');
      return;
    }

    setAuthLoading(true);
    setAuthMessage('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
      clearAuthInputs();
    } catch (error: any) {
      setAuthMessage(error?.message ?? 'Login failed.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function sendReset() {
    const email = emailInput.trim().toLowerCase();
    if (!email) {
      setAuthMessage('Enter your email to reset the password.');
      return;
    }
    setAuthLoading(true);
    setAuthMessage('');
    try {
      await sendPasswordResetEmail(auth, email);
      setAuthMessage('Password reset email sent.');
    } catch (error: any) {
      setAuthMessage(error?.message ?? 'Could not send reset email.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function logoutAccount() {
    window.location.hash = '';
    setRoom(null);
    setRoomId('');
    setIsAdminUnlocked(false);
    await signOut(auth);
    setSelectedRegisteredUserIds([]);
    setNameInput('');
    setAdminMessage('');
  }

  async function createRoom() {
    if (!identity) return;
    const newRoomId = makeRoomId();
    const newRoom = defaultRoom(newRoomId, identity);
    const createdEvent = createEvent('room_created', identity);
    newRoom.events = [createdEvent];
    await set(ref(db, `rooms/${newRoomId}`), newRoom);
    window.location.hash = `room=${newRoomId}`;
    setRoomId(newRoomId);
    setRoom(newRoom);
    setPage('setup');
    setRoomTab('table');
    setIsAdminUnlocked(true);
    setUndoStack([]);
    setSelectedRegisteredUserIds([]);
    setAdminMessage('');
    setShowAccessBox(false);
    setShowChangePinBox(false);
    setNeedsPinSetup(true);
    setSetupPinInput('');
    setSetupPinConfirmInput('');
    setSetupPinError('');
  }

  async function joinRoom(id?: string) {
    if (!identity) return;
    const normalized = (id ?? roomIdInput).trim().toUpperCase();
    if (!normalized) return;
    setLoadingRoom(true);
    setRoomId(normalized);
    window.location.hash = `room=${normalized}`;
    setIsAdminUnlocked(false);
    setAdminMessage('');
    setUndoStack([]);
    setSelectedRegisteredUserIds([]);
    setNeedsPinSetup(false);
    setSetupPinInput('');
    setSetupPinConfirmInput('');
    setSetupPinError('');
    setPage('setup');
    setRoomTab('table');

    const snapshot = await get(ref(db, `rooms/${normalized}`));
    if (!snapshot.exists()) {
      setRoomId('');
      setLoadingRoom(false);
      window.location.hash = '';
      setAdminMessage(`Room ${normalized} was not found.`);
      return;
    }
    {
      const existing = snapshot.val() as RoomState;
      const users = existing.users ?? [];
      const hasUser = users.some((u) => u.uid === identity.uid);
      if (!hasUser) {
        const nextUsers = [...users, identity];
        const joinEvent = createEvent('user_joined', identity);
        await update(ref(db, `rooms/${normalized}`), {
          users: nextUsers,
          events: [joinEvent, ...(existing.events ?? [])],
        } as never);
      }
    }
  }

  function playerExists(name: string) {
    return players.some((p) => sameName(p.name, name));
  }

  function toggleRegisteredPlayerSelection(uid: string) {
    setSelectedRegisteredUserIds((prev) => (prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]));
  }

  async function addSelectedRegisteredPlayers() {
    if (!room || !isAdminUnlocked || !identity) return;
    if (players.length >= MAX_PLAYERS) {
      setAdminMessage(`Maximum ${MAX_PLAYERS} players allowed in one tournament room.`);
      return;
    }

    const namesToAdd = selectedRegisteredUsers
      .map((user) => normalizeName(user.displayName))
      .filter(Boolean)
      .filter((name) => !playerExists(name));

    const slotsLeft = MAX_PLAYERS - players.length;
    if (namesToAdd.length > slotsLeft) {
      setAdminMessage(`Only ${slotsLeft} more player${slotsLeft === 1 ? '' : 's'} can be added.`);
      return;
    }
    if (namesToAdd.length === 0) {
      setAdminMessage('No new selected registered players to add.');
      return;
    }

    const newPlayers: Player[] = namesToAdd.map((name, index) => ({
      id: makeId(),
      name,
      buyins: 1,
      bountyBalance: 0,
      active: true,
      suit: SUITS[(players.length + index) % SUITS.length],
    }));
    const nextEvents = namesToAdd.map((name) => createEvent('player_added', identity, { playerName: name }));
    await patchRoom({ players: [...players, ...newPlayers], events: [...nextEvents, ...events] });
    setSelectedRegisteredUserIds([]);
    setAdminMessage('');
  }

  async function addPlayer() {
    if (!room || !isAdminUnlocked || !identity) return;
    const name = normalizeName(nameInput);
    if (!name) return;
    if (players.length >= MAX_PLAYERS) {
      setAdminMessage(`Maximum ${MAX_PLAYERS} players allowed in one tournament room.`);
      return;
    }
    if (playerExists(name)) {
      setAdminMessage(`${name} is already in this tournament.`);
      return;
    }
    const newPlayer: Player = {
      id: makeId(),
      name,
      buyins: 1,
      bountyBalance: 0,
      active: true,
      suit: SUITS[players.length % SUITS.length],
    };
    const event = createEvent('player_added', identity, { playerName: name });
    await patchRoom({ players: [...players, newPlayer], events: [event, ...events] });
    setNameInput('');
    setAdminMessage('');
  }

  /** The PIN lives in roomPins/, which guests watching the public room data cannot read. */
  async function savePin(pin: string) {
    try {
      await set(ref(db, `roomPins/${roomId}`), pin);
    } catch (error) {
      setAdminMessage('Could not save the PIN — check your connection.');
      throw error;
    }
  }

  async function saveInitialAdminPin() {
    const pin = setupPinInput.trim();
    const confirm = setupPinConfirmInput.trim();
    if (!room || !isAdminUnlocked) return;
    if (pin.length < 4) {
      setSetupPinError('PIN must be at least 4 characters.');
      return;
    }
    if (pin !== confirm) {
      setSetupPinError('PINs do not match.');
      return;
    }

    const event = createEvent('admin_pin_created', identity!);
    await savePin(pin);
    await patchRoom({ settings: { ...room.settings, adminPin: '', pinCreated: true }, events: [event, ...events] });
    setNeedsPinSetup(false);
    setSetupPinInput('');
    setSetupPinConfirmInput('');
    setSetupPinError('');
    setAdminMessage('Admin PIN created for this room.');
  }

  async function removePlayer(id: string) {
    if (!isAdminUnlocked || !identity) return;
    const target = players.find((p) => p.id === id);
    const event = createEvent('player_removed', identity, { playerName: target?.name ?? 'Player' });
    await patchRoom({ players: players.filter((p) => p.id !== id), events: [event, ...events] });
  }

  async function startGame() {
    if (!isAdminUnlocked || !room || !identity || players.length < 2) return;
    if (!pinCreated) {
      setAdminMessage('Create the admin PIN before starting the tournament.');
      setNeedsPinSetup(true);
      return;
    }
    const event = createEvent('game_started', identity, {
      playerCount: players.length,
      prizePool,
      bountyPot: players.length * bounty,
    });
    setUndoStack([]);
    const clock: ClockState = { running: true, levelIndex: 0, levelElapsedMs: 0, startedAt: serverNow() };
    await patchRoom({ phase: 'game', clock, events: [event, ...events] });
    setPage('live');
    setRoomTab('table');
  }

  function openEliminationModal(bustedId?: string) {
    if (!isAdminUnlocked) return;
    setSelectedEliminatedIds(bustedId ? [bustedId] : []);
    setBustedBy({});
    setKoStep(-1);
    setRebuyMap({});
    setWinningHand('');
    setIsRecordingKnockout(false);
    setKnockoutError('');
    setElimModal(true);
  }

  function toggleBustedBy(bustedId: string, winnerId: string) {
    setBustedBy((prev) => {
      const current = prev[bustedId] ?? [];
      const next = current.includes(winnerId) ? current.filter((x) => x !== winnerId) : [...current, winnerId];
      return { ...prev, [bustedId]: next };
    });
  }

  function copyBustedBy(fromId: string, toId: string) {
    setBustedBy((prev) => ({ ...prev, [toId]: [...(prev[fromId] ?? [])] }));
  }

  function toggleEliminated(id: string) {
    setSelectedEliminatedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      // A busted player can't win a bounty, and an un-busted one has no bounty to hand out.
      setBustedBy((map) => {
        const cleaned: Record<string, string[]> = {};
        next.forEach((bid) => {
          cleaned[bid] = (map[bid] ?? []).filter((w) => !next.includes(w));
        });
        return cleaned;
      });
      return next;
    });
  }

  function toggleRebuyFor(id: string) {
    // Unset means ticked (default), so the first tap unticks.
    setRebuyMap((prev) => ({ ...prev, [id]: prev[id] === false }));
  }

  /** Bounty won per player id for the current knockout form. */
  function bountyGains(): Record<string, number> {
    const gains: Record<string, number> = {};
    selectedEliminatedIds.forEach((bid) => {
      const takers = bustedBy[bid] ?? [];
      takers.forEach((w) => {
        gains[w] = (gains[w] ?? 0) + bounty / takers.length;
      });
    });
    return gains;
  }

  const knockoutReady =
    selectedEliminatedIds.length > 0 && selectedEliminatedIds.every((bid) => (bustedBy[bid] ?? []).length > 0) && !!winningHand;

  async function confirmElimination() {
    if (isRecordingKnockout || !isAdminUnlocked || !room || !identity || !knockoutReady) return;

    setIsRecordingKnockout(true);
    setKnockoutError('');

    try {
      const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'Player';
      const eliminatedPlayers = players.filter((p) => selectedEliminatedIds.includes(p.id));
      const gains = bountyGains();

      const snapshot: UndoState = {
        players: players.map((p) => ({ ...p })),
        eventIdsToRemove: [],
        label: `Undo knockout: ${eliminatedPlayers.map((p) => p.name).join(', ')}`,
        eliminatedNames: eliminatedPlayers.map((p) => p.name).join(', '),
      };

      const updatedPlayers = players.map((p) => {
        if (selectedEliminatedIds.includes(p.id)) {
          const rebuy = wantsRebuy(p.id);
          return {
            ...p,
            active: rebuy,
            buyins: rebuy ? p.buyins + 1 : p.buyins,
            bountyBalance: p.bountyBalance - bounty,
          };
        }
        if (gains[p.id]) {
          return { ...p, bountyBalance: p.bountyBalance + gains[p.id] };
        }
        return p;
      });

      const details = selectedEliminatedIds
        .map((bid) => `${nameOf(bid)} by ${(bustedBy[bid] ?? []).map(nameOf).join(' & ')}`)
        .join('; ');
      const rebuys = eliminatedPlayers.filter((p) => wantsRebuy(p.id)).map((p) => p.name);

      // Who won and who lost bounty money, for the knockout alert on every phone.
      const bountyText = [
        ...Object.entries(gains).map(([id, amount]) => `${nameOf(id)} +€${fmt(amount)}`),
        ...eliminatedPlayers.map((p) => `${p.name} −€${fmt(bounty)}`),
      ].join(' · ');

      const event = createEvent('knockout_recorded', identity, {
        details,
        bountyText,
        eliminatedNames: eliminatedPlayers.map((p) => p.name).join(', '),
        winnerNames: Object.keys(gains).map(nameOf).join(', '),
        winningHand,
        rebuys,
        totalBounty: bounty * eliminatedPlayers.length,
      });

      snapshot.eventIdsToRemove = [event.id];

      await patchRoom({
        players: updatedPlayers,
        events: [event, ...events],
      });

      setUndoStack((prev) => [...prev, snapshot].slice(-10));
      setElimModal(false);
    } catch (error) {
      console.error('Could not record knockout:', error);
      setKnockoutError('Could not record the knockout. Please check your connection and try again.');
    } finally {
      setIsRecordingKnockout(false);
    }
  }

  async function undoLastAction() {
  if (!isAdminUnlocked || !room || !identity || undoStack.length === 0) return;

const lastUndo = undoStack[undoStack.length - 1];
if (!lastUndo) return;

const undoEvent = createEvent('undo_action', identity);

await patchRoom({
  players: lastUndo.players,
  ...(lastUndo.settings ? { settings: { ...room.settings, ...lastUndo.settings } } : {}),
  events: [undoEvent, ...events.filter((event) => !lastUndo.eventIdsToRemove.includes(event.id))],
});

setUndoStack((prev) => prev.slice(0, -1));
setAdminMessage(lastUndo.label.startsWith('Undo close buy-ins') ? 'Buy-ins reopened.' : 'Last knockout action undone.');
}

  async function unlockAdmin() {
    if (!room || !identity) return;
    if (!pinCreated) {
      setAdminMessage('Admin PIN has not been created yet for this room.');
      return;
    }
    let storedPin = '';
    try {
      storedPin = (await get(ref(db, `roomPins/${roomId}`))).val() ?? '';
    } catch (error) {
      console.error('PIN read failed', error);
    }
    // Rooms created before PINs moved out of the public room data.
    if (!storedPin) storedPin = adminPin;
    if (storedPin && accessPinInput.trim() === storedPin) {
      const previousAdmin = room.currentAdmin?.displayName;
      const event = createEvent('admin_claimed', identity, { previousAdmin });
      await patchRoom({ currentAdmin: identity, events: [event, ...events] });
      setIsAdminUnlocked(true);
      setAdminMessage('Admin access granted on this device.');
      setAccessPinInput('');
      setShowAccessBox(false);
      return;
    }
    setAdminMessage('Incorrect PIN.');
  }

  async function releaseAdmin() {
    if (!room || !identity) return;
    const event = createEvent('admin_released', identity);
    await patchRoom({ currentAdmin: null, events: [event, ...events] });
    setIsAdminUnlocked(false);
    setShowChangePinBox(false);
    setShowAccessBox(false);
    setAccessPinInput('');
    setNewPinInput('');
    setAdminMessage('Admin access released on this device.');
    setElimModal(false);
    setShowPayoutModal(false);
  }

  async function changeAdminPin() {
    const trimmed = newPinInput.trim();
    if (!isAdminUnlocked || !room || !identity) {
      setAdminMessage('Unlock admin access first.');
      return;
    }
    if (trimmed.length < 4) {
      setAdminMessage('PIN must be at least 4 characters.');
      return;
    }
    const event = createEvent('admin_pin_changed', identity);
    await savePin(trimmed);
    await patchRoom({ settings: { ...room.settings, adminPin: '', pinCreated: true }, events: [event, ...events] });
    setNewPinInput('');
    setShowChangePinBox(false);
    setAdminMessage('Admin PIN updated for this room.');
  }

  async function updateBuyIn(value: string) {
    if (!room || !isAdminUnlocked) return;
    const n = Number(value);
    if (Number.isNaN(n) || n <= 0) return;
    await patchRoom({ settings: { ...room.settings, buyIn: n } });
  }

  async function updateBounty(value: string) {
    if (!room || !isAdminUnlocked) return;
    const n = Number(value);
    if (Number.isNaN(n) || n < 0) return;
    await patchRoom({ settings: { ...room.settings, bounty: n } });
  }

async function closeBuyins() {
  if (!room || !isAdminUnlocked || !identity || buyinsClosedFlag) return;
  const event = createEvent('buyins_closed', identity);

  const snapshot: UndoState = {
    players: players.map((p) => ({ ...p })),
    eventIdsToRemove: [event.id],
    label: 'Undo close buy-ins',
    settings: { buyinsClosed: false },
  };

  await patchRoom({
    settings: { ...room.settings, buyinsClosed: true },
    events: [event, ...events],
  });
  setUndoStack((prev) => [...prev, snapshot].slice(-10));
  setAdminMessage('Buy-ins are now closed for this tournament.');
}


  /** Fill the payout amounts with the default split for `places` (whole euros). */
  async function applyDefaultPayouts(places: number) {
    if (!room || !isAdminUnlocked) return;
    const amounts = splitPool(prizePool, places);
    const next = { ...room.payouts, mode: places };
    PAYOUT_KEYS.forEach((key, i) => {
      next[key] = i < places ? String(amounts[i]) : '';
    });
    await patchRoom({ payouts: next });
  }

  async function changePlaces(delta: number) {
    if (!room || !isAdminUnlocked || !identity) return;
    const mode = Math.min(MAX_PLACES, Math.max(1, payoutMode + delta));
    if (mode === payoutMode) return;
    const next = { ...room.payouts, mode };
    // Removing a place clears its amount and finisher so nothing stale is paid out.
    if (delta < 0) {
      const removed = PAYOUT_KEYS[payoutMode - 1];
      next[removed] = '';
      setFinishers((prev) => ({ ...prev, [removed]: '' }));
    }
    const event = createEvent('payouts_updated', identity, { mode });
    await patchRoom({ payouts: next, events: [event, ...events] });
  }

  function openFinishModal() {
    // First time: pre-fill the house default for this table size.
    const anyAmount = PAYOUT_KEYS.some((key) => String(payouts[key] ?? '').trim() !== '');
    if (!anyAmount) void applyDefaultPayouts(defaultPlaces(players.length));
    setShowPayoutModal(true);
  }

  async function updatePayoutValue(key: PayoutKey, value: string) {
    if (!room || !isAdminUnlocked) return;
    await patchRoom({ payouts: { ...room.payouts, [key]: value } });
  }

  async function finishTournament() {
    if (!isAdminUnlocked || !room || !identity || remaining !== 0) return;
    const winner = sortedForEnd[0]?.name ?? 'Unknown';
    const event = createEvent('tournament_finished', identity, { winner });
    const historyItem: HistoryItem = {
      roomId: room.roomId,
      title: room.title,
      createdAt: room.createdAt,
      completedAt: Date.now(),
      winner,
      playerCount: room.players.length,
      buyIn: room.settings.buyIn,
      bounty: room.settings.bounty,
      payoutMode: room.payouts.mode,
      createdBy: room.createdBy.displayName,
    };
    await patchRoom({
  phase: 'end',
  payouts: {
    ...room.payouts,
    firstPlayerId: finishers.first,
    secondPlayerId: finishers.second,
    thirdPlayerId: finishers.third,
    fourthPlayerId: finishers.fourth,
    fifthPlayerId: finishers.fifth,
    sixthPlayerId: finishers.sixth,
  },
  events: [event, ...events],
});
    await set(ref(db, `history/${room.roomId}`), historyItem);
    setShowPayoutModal(false);
    setUndoStack([]);
    setPage('completed');
  }

  async function createFreshRoomFromCurrent() {
    if (!room || !identity) return;
    const newRoomId = makeRoomId();
    const base = defaultRoom(newRoomId, identity);
    base.title = randomTournamentName(room.title);
    base.settings.buyIn = room.settings.buyIn;
    base.settings.bounty = room.settings.bounty;
    base.settings.levels = levels;
    base.settings.lateRegLevel = lateRegLevel;
    base.players = room.players.map((p, index) => ({
      id: makeId(),
      name: p.name,
      buyins: 1,
      bountyBalance: 0,
      active: true,
      suit: SUITS[index % SUITS.length],
    }));
    const createdEvent = createEvent('room_created', identity);
    base.events = [createdEvent];
    await set(ref(db, `rooms/${newRoomId}`), base);
    if (room) {
      const sourceEvent = createEvent('fresh_room_created', identity, { newRoomId });
      await patchRoom({ events: [sourceEvent, ...events] });
    }
    window.location.hash = `room=${newRoomId}`;
    setRoomId(newRoomId);
    setRoom(base);
    setPage('setup');
    setRoomTab('table');
    setIsAdminUnlocked(true);
    setNeedsPinSetup(true);
    setAdminMessage('Fresh room created from completed tournament.');
  }

  async function openHistoryRoom(item: HistoryItem) {
    await joinRoom(item.roomId);
  }

  function levelName(index: number) {
    const level = levels[index];
    if (!level) return 'the final level';
    const number = levels.slice(0, index + 1).filter((l) => !l.isBreak).length;
    return level.isBreak ? 'Break' : `Level ${number} (${blindsLabel(level)})`;
  }

  async function writeClock(next: ClockState, eventType?: 'clock_started' | 'clock_paused' | 'level_changed') {
    if (!isAdminUnlocked || !identity) return;
    const event = eventType ? createEvent(eventType, identity, { level: levelName(next.levelIndex) }) : null;
    await patchRoom({ clock: next, ...(event ? { events: [event, ...events] } : {}) });
  }

  function startClock() {
    return writeClock(
      { running: true, levelIndex: clockView.levelIndex, levelElapsedMs: clockView.elapsedMs, startedAt: serverNow() },
      'clock_started'
    );
  }

  function pauseClock() {
    return writeClock(
      { running: false, levelIndex: clockView.levelIndex, levelElapsedMs: clockView.elapsedMs, startedAt: null },
      'clock_paused'
    );
  }

  function jumpLevel(delta: number) {
    const levelIndex = Math.min(Math.max(0, clockView.levelIndex + delta), levels.length - 1);
    return writeClock(
      { running: clockView.running, levelIndex, levelElapsedMs: 0, startedAt: clockView.running ? serverNow() : null },
      'level_changed'
    );
  }

  function restartLevel() {
    return writeClock({
      running: clockView.running,
      levelIndex: clockView.levelIndex,
      levelElapsedMs: 0,
      startedAt: clockView.running ? serverNow() : null,
    });
  }

  function addMinute() {
    return writeClock({
      running: clockView.running,
      levelIndex: clockView.levelIndex,
      levelElapsedMs: clockView.elapsedMs - 60_000,
      startedAt: clockView.running ? serverNow() : null,
    });
  }

  async function saveLevels(next: BlindLevel[], message = 'Blind structure saved.') {
    if (!room || !isAdminUnlocked || !identity) return;
    const event = createEvent('blinds_updated', identity);
    // Mid-game: re-anchor the clock on the level being played, so changing level lengths
    // never makes the clock jump to a different level.
    const clock: ClockState | undefined =
      phase === 'game'
        ? {
            running: clockView.running,
            levelIndex: Math.min(clockView.levelIndex, next.length - 1),
            levelElapsedMs: clockView.elapsedMs,
            startedAt: clockView.running ? serverNow() : null,
          }
        : undefined;
    await patchRoom({ settings: { ...room.settings, levels: next }, ...(clock ? { clock } : {}), events: [event, ...events] });
    setAdminMessage(message);
  }

  async function renameTournament() {
    if (!room || !isAdminUnlocked || !identity) return;
    const title = randomTournamentName(room.title);
    const event = createEvent('title_changed', identity, { title });
    await patchRoom({ title, events: [event, ...events] });
  }

  function setLevelMinutes(minutes: number) {
    rememberMinutes(minutes);
    if (phase !== 'game') {
      return saveLevels(levels.map((level) => (level.isBreak ? level : { ...level, minutes })), `Levels set to ${minutes} min.`);
    }
    // Live game: change the current level and everything after it. If the current level has
    // already run longer than the new length, leave it alone and start from the next level.
    const current = clockView.levelIndex;
    const startsNow = clockView.elapsedMs < minutes * 60_000;
    const from = startsNow ? current : current + 1;
    const next = levels.map((level, i) => (i >= from && !level.isBreak ? { ...level, minutes } : level));
    return saveLevels(
      next,
      startsNow ? `Levels are now ${minutes} min, starting with this one.` : `This level already passed ${minutes} min — ${minutes} min levels start next level.`
    );
  }

  function soundLabel(sound: LevelSound) {
    const uid = toneUidOf(sound);
    if (uid) {
      const tone = toneList.find((t) => t.uid === uid);
      return tone ? `${tone.name} (${tone.ownerName})` : 'deleted tone — fanfare plays instead';
    }
    return sound === 'song' ? 'Blinds Rise song' : sound === 'doot' ? 'doot doot' : 'fanfare';
  }

  async function setLevelSound(levelSound: LevelSound) {
    if (!room || !isAdminUnlocked) return;
    await patchRoom({ settings: { ...room.settings, levelSound } });
    setAdminMessage(`Blinds-up sound: ${soundLabel(levelSound)}.`);
  }

  async function updateLateRegLevel(value: number) {
    if (!room || !isAdminUnlocked) return;
    await patchRoom({ settings: { ...room.settings, lateRegLevel: value } });
  }

  async function toggleAlerts() {
    if (alertsEnabled) {
      stopSong();
      setAlertsEnabled(false);
      setAdminMessage('Alerts turned off on this device.');
      return;
    }
    await unlockAudio();
    playSound('test');
    vibrate([120]);
    setAlertsEnabled(true);
    const permission = await requestNotificationPermission();
    setAdminMessage(
      permission === 'granted'
        ? 'Alerts on: sound, vibration and notifications when blinds go up.'
        : permission === 'denied'
          ? 'Sound alerts on. Notifications are blocked in your browser settings.'
          : 'Sound alerts on. Keep this screen open for alerts.'
    );
  }

  async function shareRoom() {
    if (!shareLink) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: room?.title ?? 'Poker room', text: `Join poker room ${roomId}`, url: shareLink });
      } catch {
        // User closed the share sheet.
      }
      return;
    }
    await copyShareLink();
  }

  /** Open a room read-only, without an account. */
  async function watchRoom(code: string) {
    const id = code.trim().toUpperCase();
    if (!id) return;
    window.location.hash = `room=${id}`;
    setRoomError('');
    setShowLogin(false);
    setRoomTab('table');
    setLoadingRoom(true);
    if (!auth.currentUser) {
      try {
        // Satisfies database rules that require any signed-in user.
        await signInAnonymously(auth);
      } catch (error) {
        // Anonymous auth not enabled — the read below still works if the rules allow public reads.
        console.warn('Anonymous sign-in unavailable', error);
      }
    }
    setRoomId(id);
  }

  function leaveRoom() {
    window.location.hash = '';
    setRoomId('');
    setRoom(null);
    setIsAdminUnlocked(false);
    setUndoStack([]);
    setElimModal(false);
    setShowPayoutModal(false);
    setNeedsPinSetup(false);
    setRoomTab('table');
    setPage('home');
  }

  async function copyShareLink() {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setAdminMessage('Share link copied.');
  }

  async function copyRoomId() {
    if (!roomId) return;
    await navigator.clipboard.writeText(roomId);
    setAdminMessage('Room ID copied.');
  }

  const toast = adminMessage ? (
    <div className="toast" role="status" onClick={() => setAdminMessage('')}>
      {adminMessage}
    </div>
  ) : null;

  if (authBooting) {
    return (
      <div className="app-shell splash">
        <div className="brand-icon big">
          <Spade size={30} />
        </div>
        <div className="muted">Checking your session…</div>
      </div>
    );
  }

  const spectating = !identity && !!roomId && !showLogin;

  const liveList = (
    <section className="card live-card">
      <div className="section-head">
        <div className="section-title live-title">
          <span className="live-dot" /> Live now
        </div>
        {liveRooms.length > 0 && <span className="pill">{liveRooms.length}</span>}
      </div>
      {liveLoading ? (
        <div className="muted small-copy">Looking for tables…</div>
      ) : liveRooms.length === 0 ? (
        <div className="empty-state">
          <Spade size={24} />
          <div>No tournaments running right now.</div>
        </div>
      ) : (
        <div className="stack-list">
          {liveRooms.map((live) => {
            const v = live.phase === 'game' && live.clock ? computeClock(live.clock ?? undefined, normalizeLevels(live.levels), liveNow) : null;
            return (
              <button
                key={live.roomId}
                className={`live-row ${live.phase === 'game' ? 'is-live' : ''}`}
                onClick={() => (identity ? void joinRoom(live.roomId) : void watchRoom(live.roomId))}
              >
                <div className="live-main">
                  <div className="player-name">{live.title}</div>
                  <div className="tiny muted">
                    {live.phase === 'game'
                      ? `${live.left}/${live.players} left · €${fmt(live.pool)} pool`
                      : `Starting soon · ${live.players} player${live.players === 1 ? '' : 's'}`}
                  </div>
                </div>
                {v && (
                  <div className="live-side">
                    <strong>{v.level.isBreak ? 'Break' : `${chips(v.level.sb)}/${chips(v.level.bb)}`}</strong>
                    <span className={v.running ? '' : 'paused'}>{v.running ? formatClock(v.remainingMs) : 'Paused'}</span>
                  </div>
                )}
                <ChevronRight size={18} className="muted" />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );

  if (!identity && spectating && !room) {
    return (
      <div className="app-shell splash">
        <div className="brand-icon big">
          <Eye size={30} />
        </div>
        {roomError ? (
          <>
            <div className="muted" style={{ textAlign: 'center', maxWidth: 300 }}>
              {roomError}
            </div>
            <button className="btn btn-green" onClick={() => setShowLogin(true)}>
              <LogIn size={16} /> Log in
            </button>
            <button className="btn btn-ghost" onClick={leaveRoom}>
              Back
            </button>
          </>
        ) : (
          <div className="muted">Loading room {roomId}…</div>
        )}
      </div>
    );
  }

  if (!identity && !spectating) {
    return (
      <div className="app-shell">
        <main className="page auth-page">
          <div className="auth-hero">
            <div className="brand-icon big">
              <Spade size={30} />
            </div>
            <h1>Home Poker Tracker</h1>
            <p className="muted">Blinds clock, knockouts, bounties and payouts — shared live on every phone.</p>
          </div>

          {!roomId && liveList}

          <div className="section-title" style={{ margin: '18px 4px 10px' }}>
            Running a game? Log in
          </div>

          <section className="card">
            <div className="segmented">
              {(['login', 'register', 'reset'] as AuthMode[]).map((mode) => (
                <button
                  key={mode}
                  className={authMode === mode ? 'active' : ''}
                  onClick={() => {
                    setAuthMode(mode);
                    setAuthMessage('');
                  }}
                >
                  {mode === 'login' ? 'Log in' : mode === 'register' ? 'Register' : 'Reset'}
                </button>
              ))}
            </div>

            <form
              className="stack-list"
              onSubmit={(e) => {
                e.preventDefault();
                if (authMode === 'login') void loginAccount();
                else if (authMode === 'register') void registerAccount();
                else void sendReset();
              }}
            >
              {authMode === 'register' && (
                <input value={displayNameInput} onChange={(e) => setDisplayNameInput(e.target.value)} placeholder="Display name" autoComplete="nickname" />
              )}
              <input value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="Email address" type="email" autoComplete="email" inputMode="email" />
              {authMode !== 'reset' && (
                <input
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Password"
                  type="password"
                  autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                />
              )}
              {authMode === 'register' && (
                <input value={confirmPasswordInput} onChange={(e) => setConfirmPasswordInput(e.target.value)} placeholder="Confirm password" type="password" autoComplete="new-password" />
              )}
              <button type="submit" className={`btn btn-block ${authMode === 'reset' ? 'btn-gold' : 'btn-green'}`} disabled={authLoading}>
                {authLoading ? 'Please wait…' : authMode === 'login' ? 'Log in' : authMode === 'register' ? 'Create account' : 'Send reset email'}
              </button>
            </form>
            <p className="tiny muted" style={{ marginBottom: 0 }}>
              {authMode === 'register'
                ? 'Your display name appears in room logs and the registered players list.'
                : authMode === 'reset'
                  ? 'We will email you a password reset link.'
                  : 'Sign in with your registered email and password.'}
            </p>
            {authMessage && <div className="note-box">{authMessage}</div>}
          </section>

          {roomId && (
            <button className="btn btn-ghost btn-block" onClick={() => setShowLogin(false)}>
              Back to {room?.title ?? 'the tournament'}
            </button>
          )}
        </main>
        {toast}
      </div>
    );
  }

  const historyList =
    history.length === 0 ? (
      <div className="empty-state">
        <Trophy size={28} />
        <div>Completed tournaments will appear here.</div>
      </div>
    ) : (
      <div className="stack-list">
        {history.map((item) => (
          <button className="history-row" key={item.roomId} onClick={() => openHistoryRoom(item)}>
            <div className="history-main">
              <div className="player-name">{item.title}</div>
              <div className="tiny muted">
                {new Date(item.completedAt).toLocaleDateString()} · 🏆 {item.winner} · {item.playerCount} players · €{fmt(item.buyIn)}+€{fmt(item.bounty)}
              </div>
            </div>
            <ChevronRight size={18} className="muted" />
          </button>
        ))}
      </div>
    );

  if (!room || !identity && !spectating) {
    if (!identity) return null;
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-icon">
              <Spade size={20} />
            </div>
            <div className="brand-text">
              <h1>Poker Tracker</h1>
              <p>Hi, {identity.displayName}</p>
            </div>
          </div>
          <button className="icon-chip" onClick={logoutAccount} aria-label="Log out">
            <LogOut size={18} />
          </button>
        </header>
        <main className="page">
          <div className="segmented" style={{ marginBottom: 14 }}>
            <button className={page !== 'history' ? 'active' : ''} onClick={() => setPage('home')}>
              Play
            </button>
            <button className={page === 'history' ? 'active' : ''} onClick={() => setPage('history')}>
              History
            </button>
          </div>

          {page === 'history' ? (
            <section className="card">
              <div className="section-head">
                <div className="section-title">Tournament History</div>
                <span className="pill">{history.length} saved</span>
              </div>
              {historyList}
            </section>
          ) : (
            <>
              {liveList}
              <section className="card">
                <div className="section-title">New tournament</div>
                <p className="muted small-copy">Create a room, invite players with the code and run the blinds clock from your phone.</p>
                <button className="btn btn-green btn-block btn-lg" onClick={createRoom}>
                  Create new room
                </button>
              </section>
              <section className="card">
                <div className="section-title">Join a room</div>
                <form
                  className="input-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void joinRoom();
                  }}
                >
                  <input
                    value={roomIdInput}
                    onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                    placeholder="Room code"
                    className="code-input"
                    autoCapitalize="characters"
                    autoComplete="off"
                    maxLength={8}
                  />
                  <button type="submit" className="btn btn-gold" disabled={!roomIdInput.trim() || loadingRoom}>
                    {loadingRoom ? '…' : 'Join'}
                  </button>
                </form>
              </section>
              <section className="card">
                <div className="section-title">Theme</div>
                <ThemePicker />
              </section>
            </>
          )}
        </main>
        {toast}
      </div>
    );
  }

  const phaseLabel = phase === 'setup' ? 'Setup' : phase === 'game' ? 'Live' : 'Results';
  const lastUndo = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;
  const standings = [...players].sort((a, b) => Number(b.active) - Number(a.active) || b.bountyBalance - a.bountyBalance);
  const lateRegLabel = lateRegIndex >= 0 ? levelName(lateRegIndex) : '';
  const playingLevels = levels.filter((l) => !l.isBreak);

  const lockedBanner = !isAdminUnlocked && (
    <button className="locked-banner" onClick={() => (identity ? setRoomTab('room') : setShowLogin(true))}>
      {identity ? <Lock size={16} /> : <Eye size={16} />}
      <span>
        {!identity ? 'Watching live as guest — log in to manage' : pinCreated ? 'View only — tap to unlock admin controls' : 'View only — waiting for admin'}
      </span>
      <ChevronRight size={16} />
    </button>
  );

  const lateRegNote = (
    <div className={`status-line ${buyinsClosed ? 'closed' : lateRegPassed ? 'due' : 'open'}`}>
      <span className="dot" />
      {buyinsClosed
        ? 'Buy-ins closed — no more rebuys'
        : lateRegPassed
          ? `Buy-ins still open — ${lateRegLabel} is over`
          : lateRegIndex >= 0
            ? `Buy-ins open · close after ${lateRegLabel}`
            : 'Buy-ins open'}
      {isAdminUnlocked && phase === 'game' && !buyinsClosed && (
        <button className="link-btn" onClick={() => closeBuyins()}>
          Close now
        </button>
      )}
    </div>
  );

  // In a live game the timer reflects the current and upcoming levels only.
  const playMinutes = (phase === 'game' ? levels.slice(clockView.levelIndex) : levels).filter((l) => !l.isBreak).map((l) => l.minutes);
  const uniformMinutes = playMinutes.length > 0 && playMinutes.every((m) => m === playMinutes[0]) ? playMinutes[0] : null;

  const levelTimer = (
    <div className="field">
      <span>{phase === 'game' ? 'Level length from now' : 'Round time'}</span>
      {isAdminUnlocked ? (
        <MinutesPicker value={uniformMinutes ?? playMinutes[0] ?? 15} onCommit={setLevelMinutes} />
      ) : (
        <>
          <div className="blind-summary-line">{uniformMinutes ? `${uniformMinutes} min per level` : 'Mixed level lengths'}</div>
          {identity && (
            <button className="link-btn" style={{ marginLeft: 0 }} onClick={() => setRoomTab('room')}>
              Unlock admin to change
            </button>
          )}
        </>
      )}
    </div>
  );

  const blindStructureCard = (
    <section className="card">
      <div className="section-title">Blind timer</div>
      {levelTimer}
      <details className="collapsible level-details">
        <summary>
          <span className="blind-summary-line">
            Starts {blindsLabel(levels[0])} · {playingLevels.length} levels
          </span>
          <ChevronRight size={18} className="chev" />
        </summary>
        <BlindStructureEditor levels={levels} isAdmin={isAdminUnlocked} currentIndex={phase === 'game' ? clockView.levelIndex : undefined} onSave={saveLevels} />
      </details>
    </section>
  );

  return (
    <div className="app-shell has-nav">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <Spade size={20} />
          </div>
          <div className="brand-text">
            <h1>{room.title}</h1>
            <p>
              <span className={`phase-dot ${phase}`} /> {phaseLabel} · {room.currentAdmin ? `Admin ${room.currentAdmin.displayName}` : 'No admin'}
            </p>
          </div>
        </div>
        <button className="room-code-chip" onClick={shareRoom} aria-label="Share room">
          <span>{roomId}</span>
          <Share2 size={16} />
        </button>
      </header>

      <main className="page">
        {roomTab === 'table' && phase === 'setup' && (
          <>
            {lockedBanner}

            <section className="card title-card">
              <div className="section-title">Tonight’s tournament</div>
              <div className="title-row">
                <div className="tournament-name">{room.title}</div>
                {isAdminUnlocked && (
                  <button className="icon-chip" onClick={renameTournament} aria-label="New random name">
                    <Dices size={18} />
                  </button>
                )}
              </div>
            </section>


            <section className="card">
              <div className="section-head">
                <div className="section-title">Buy-in &amp; bounty</div>
                <span className={`pill ${buyinsClosed ? 'pill-red' : 'pill-green'}`}>{buyinsClosed ? 'Buy-ins closed' : 'Buy-ins open'}</span>
              </div>
              <div className="field-grid">
                <NumberField label="Buy-in (prize pool)" prefix="€" value={buyIn} min={1} step={1} disabled={!isAdminUnlocked} onCommit={(v) => updateBuyIn(String(v))} />
                <NumberField label="Bounty per player" prefix="€" value={bounty} min={0} step={0.5} disabled={!isAdminUnlocked} onCommit={(v) => updateBounty(String(v))} />
              </div>
              <label className="field">
                <span>Remind admin to close buy-ins after</span>
                <select value={lateRegLevel} onChange={(e) => updateLateRegLevel(Number(e.target.value))} disabled={!isAdminUnlocked}>
                  <option value={0}>No reminder</option>
                  {playingLevels.map((level, i) => (
                    <option key={i} value={i + 1}>
                      Level {i + 1} · {blindsLabel(level)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="badge-row">
                <Badge label="Pool" value={`€${fmt(buyIn)}`} />
                <Badge label="Bounty" value={`€${fmt(bounty)}`} />
                <Badge label="Per player" value={`€${fmt(buyIn + bounty)}`} tone="gold" />
              </div>
            </section>

            {blindStructureCard}

            <section className="card">
              <div className="section-head">
                <div className="section-title">Players</div>
                <span className="pill">
                  {players.length}/{MAX_PLAYERS}
                </span>
              </div>

              {registeredUsers.length > 0 && (
                <>
                  <div className="sub-label">Registered players</div>
                  <div className="chip-grid">
                    {registeredUsers.map((user) => {
                      const selected = selectedRegisteredUserIds.includes(user.uid);
                      const already = players.some((p) => sameName(p.name, user.displayName));
                      return (
                        <button
                          key={user.uid}
                          type="button"
                          onClick={() => toggleRegisteredPlayerSelection(user.uid)}
                          className={`select-chip ${selected ? 'selected' : ''}`}
                          disabled={already || !isAdminUnlocked}
                        >
                          {already ? '✓ ' : selected ? '+ ' : ''}
                          {user.displayName}
                        </button>
                      );
                    })}
                  </div>
                  {selectedRegisteredUserIds.length > 0 && (
                    <div className="btn-pair" style={{ marginTop: 10 }}>
                      <button className="btn btn-ghost" onClick={() => setSelectedRegisteredUserIds([])}>
                        Clear
                      </button>
                      <button className="btn btn-green" onClick={addSelectedRegisteredPlayers} disabled={!isAdminUnlocked || players.length >= MAX_PLAYERS}>
                        <UserPlus size={16} /> Add {selectedRegisteredUserIds.length}
                      </button>
                    </div>
                  )}
                </>
              )}

              <div className="sub-label">Guest player</div>
              <form
                className="input-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (isAdminUnlocked) void addPlayer();
                }}
              >
                <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder={isAdminUnlocked ? 'Guest name' : 'Unlock admin to add'} disabled={!isAdminUnlocked} autoComplete="off" />
                <button type="submit" className="btn btn-green" disabled={!isAdminUnlocked || !normalizeName(nameInput) || players.length >= MAX_PLAYERS}>
                  Add
                </button>
              </form>

              {players.length === 0 ? (
                <div className="empty-state">
                  <Users size={26} />
                  <div>Add at least 2 players to start.</div>
                </div>
              ) : (
                <div className="stack-list">
                  {players.map((p) => (
                    <div className="player-row" key={p.id}>
                      <span className={`suit ${p.suit === '♥' || p.suit === '♦' ? 'red' : ''}`}>{p.suit}</span>
                      <span className="player-name">{p.name}</span>
                      {isAdminUnlocked && (
                        <button className="icon-btn" onClick={() => removePlayer(p.id)} aria-label={`Remove ${p.name}`}>
                          <X size={18} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card invite-card">
              <div>
                <div className="section-title">Invite players</div>
                <div className="invite-code">{roomId}</div>
                <div className="tiny muted">Players open the link or enter this code.</div>
              </div>
              <div className="invite-actions">
                <button className="btn btn-gold" onClick={shareRoom}>
                  <Share2 size={16} /> Share
                </button>
                <button className="btn btn-dark" onClick={copyRoomId}>
                  <Copy size={16} /> Code
                </button>
              </div>
            </section>

            {players.length >= 2 && isAdminUnlocked && (
              <div className="sticky-cta">
                <div className="sticky-cta-info">
                  <strong>{players.length} players</strong>
                  <span>
                    €{fmt(prizePool)} · {blindsLabel(levels[0])} · {levels[0].minutes} min
                  </span>
                </div>
                <button className="btn btn-green btn-lg" onClick={startGame}>
                  Start
                </button>
              </div>
            )}
          </>
        )}

        {roomTab === 'table' && phase === 'game' && (
          <>
            {lockedBanner}

            <h2 className="game-name">{room.title}</h2>

            <TournamentClock
              view={clockView}
              isAdmin={isAdminUnlocked}
              alertsEnabled={alertsEnabled}
              onToggleAlerts={toggleAlerts}
              onStart={startClock}
              onPause={pauseClock}
              onNext={() => jumpLevel(1)}
              onPrev={() => jumpLevel(-1)}
              onRestart={restartLevel}
              onAddMinute={addMinute}
              canPrev={clockView.levelIndex > 0}
              canNext={clockView.levelIndex < levels.length - 1}
            />

            <div className="stats-strip">
              <div>
                <span>Pool</span>
                <strong className="gold">€{fmt(prizePool)}</strong>
              </div>
              <div>
                <span>Left</span>
                <strong>
                  {activePlayers.length}/{players.length}
                </strong>
              </div>
              <div>
                <span>Bounty</span>
                <strong>€{fmt(bounty)}</strong>
              </div>
            </div>
            {lateRegNote}

            <section className="card compact-card">
              <div className="section-head">
                <div className="section-title">Standings</div>
                <span className="pill">{activePlayers.length} in</span>
              </div>
              {isAdminUnlocked && activePlayers.length > 1 && <div className="tiny muted hint">Tap a player who busted to record the knockout.</div>}
              <div className="standings-head">
                <span />
                <span>Player</span>
                <span>Buy-in</span>
                <span>Bounty net</span>
              </div>
              <div className="standings-list">
                {standings.map((p) => {
                  const tappable = isAdminUnlocked && p.active && activePlayers.length > 1;
                  const paid = p.buyins * buyIn;
                  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}€${fmt(Math.abs(n))}`;
                  const content = (
                    <>
                      <span className={`suit ${p.suit === '♥' || p.suit === '♦' ? 'red' : ''}`}>{p.suit}</span>
                      <span className="player-name">{p.name}</span>
                      <span className="col-num">
                        €{fmt(paid)}
                        {p.buyins > 1 && <span className="rebuy-tag">×{p.buyins}</span>}
                      </span>
                      <span className={`col-num net ${p.bountyBalance > 0 ? 'plus' : p.bountyBalance < 0 ? 'minus' : ''}`}>{signed(p.bountyBalance)}</span>
                    </>
                  );
                  return tappable ? (
                    <button key={p.id} className="standing-row" onClick={() => openEliminationModal(p.id)}>
                      {content}
                    </button>
                  ) : (
                    <div key={p.id} className={`standing-row ${!p.active ? 'out' : ''}`}>
                      {content}
                    </div>
                  );
                })}
              </div>
            </section>

            {isAdminUnlocked && <section className="card compact-card">{levelTimer}</section>}

            <details className="card collapsible">
              <summary>
                <span className="section-title">Blind structure</span>
                <ChevronRight size={18} className="chev" />
              </summary>
              <BlindStructureEditor levels={levels} isAdmin={isAdminUnlocked} currentIndex={clockView.levelIndex} onSave={saveLevels} />
            </details>

            {isAdminUnlocked && (
              <div className="action-bar">
                <button className="action-btn" onClick={undoLastAction} disabled={!lastUndo} aria-label={lastUndo?.label ?? 'Undo'}>
                  <Undo2 size={20} />
                  <span>Undo</span>
                </button>
                <button
                  className={`action-btn ${clockView.running ? '' : 'green'}`}
                  onClick={clockView.running ? pauseClock : startClock}
                  disabled={clockView.finished}
                  aria-label={clockView.running ? 'Pause clock' : 'Start clock'}
                >
                  {clockView.running ? <Pause size={20} /> : <Play size={20} />}
                  <span>{clockView.running ? 'Pause' : 'Resume'}</span>
                </button>
                <button className="btn btn-red action-main" onClick={() => openEliminationModal()} disabled={activePlayers.length < 2}>
                  <Skull size={18} /> Knockout
                </button>
                <button
                  className="action-btn gold"
                  onClick={openFinishModal}
                  disabled={activePlayers.length > FINISH_ALLOWED_AT}
                  aria-label={activePlayers.length > FINISH_ALLOWED_AT ? `Finish available at ${FINISH_ALLOWED_AT} players` : 'Finish tournament'}
                >
                  <Flag size={20} />
                  <span>{activePlayers.length > FINISH_ALLOWED_AT ? `At ${FINISH_ALLOWED_AT}` : 'Finish'}</span>
                </button>
              </div>
            )}
          </>
        )}

        {roomTab === 'table' && phase === 'end' && (
          <>
            <section className="card winner-card">
              <div className="trophy">🏆</div>
              <div className="end-title">{finalStandings[0]?.name ?? 'Tournament complete'}</div>
              <div className="muted">Prize pool €{fmt(prizePool)} settled</div>
            </section>

            <div className="stats-grid two">
              <Badge label="Total pool" value={`€${fmt(prizePool)}`} tone="gold" />
              <Badge label="Bounties won" value={`€${fmt(totalBountyPot)}`} />
            </div>

            <section className="card">
              <div className="section-title">Final standings</div>
              <div className="stack-list">
                {finalStandings.map((p, index) => {
                  const payoutKey = payoutKeyForIndex(index);
                  const finishingAmount = payoutKey && index < payoutMode ? Number(payouts[payoutKey]) || 0 : 0;
                  const totalBuyinCost = p.buyins * buyIn;
                  // Pot net = prize won − buy-ins paid; bounty net = bounties won − lost. Kept separate.
                  const potNet = finishingAmount - totalBuyinCost;
                  const totalReturn = potNet + p.bountyBalance;
                  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}€${fmt(Math.abs(n))}`;
                  const tone = (n: number) => (n > 0 ? 'plus' : n < 0 ? 'minus' : '');
                  return (
                    <div className={`result-card ${index < 3 ? 'podium' : ''}`} key={p.id}>
                      <div className="medal">{placeIcon(index)}</div>
                      <div className="standing-main">
                        <div className="player-name">{p.name}</div>
                        <div className="tiny muted">
                          Prize €{fmt(finishingAmount)} · paid in €{fmt(totalBuyinCost)}
                        </div>
                        <div className="net-pair">
                          <span>
                            Pot net <strong className={tone(potNet)}>{signed(potNet)}</strong>
                          </span>
                          <span>
                            Bounty net <strong className={tone(p.bountyBalance)}>{signed(p.bountyBalance)}</strong>
                          </span>
                        </div>
                      </div>
                      <div className="result-side">
                        <span>Total</span>
                        <strong className={`result-total ${tone(totalReturn)}`}>{signed(totalReturn)}</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <SplitwiseCard
              title={room?.title ?? ''}
              rows={splitRows}
              onMessage={setAdminMessage}
              canAdd={isAdminUnlocked && canAddToSplitwise(identity?.displayName)}
              added={room?.splitwise}
              onAdded={({ expenseId, groupName }) =>
                patchRoom({
                  splitwise: { expenseId, groupName, addedBy: identity?.displayName ?? 'admin', addedAt: Date.now() },
                })
              }
            />

            <button className="btn btn-green btn-block btn-lg" onClick={createFreshRoomFromCurrent}>
              Rematch with same players
            </button>
          </>
        )}

        {roomTab === 'log' && (
          <section className="card">
            <div className="section-head">
              <div className="section-title">Event timeline</div>
              <span className="pill">{events.length}</span>
            </div>
            {events.length === 0 ? (
              <div className="empty-state">No events recorded yet.</div>
            ) : (
              <div className="log-list">
                {events.map((entry) => (
                  <div className={`log-row type-${entry.type}`} key={entry.id}>
                    <span className="log-time">{entry.time}</span>
                    <span>{entry.text}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {roomTab === 'history' && (
          <section className="card">
            <div className="section-head">
              <div className="section-title">Tournament history</div>
              <span className="pill">{history.length} saved</span>
            </div>
            {historyList}
          </section>
        )}

        {roomTab === 'room' && (
          <>
            <section className="card invite-card">
              <div>
                <div className="section-title">Room code</div>
                <div className="invite-code">{roomId}</div>
              </div>
              <div className="invite-actions">
                <button className="btn btn-gold" onClick={shareRoom}>
                  <Share2 size={16} /> Share
                </button>
                <button className="btn btn-dark" onClick={copyShareLink}>
                  <Copy size={16} /> Link
                </button>
              </div>
            </section>

            {!identity && (
              <section className="card">
                <div className="section-title">Watching as guest</div>
                <p className="muted small-copy">Log in to take admin access or play as a registered player.</p>
                <div className="btn-pair">
                  <button className="btn btn-dark" onClick={leaveRoom}>
                    <DoorOpen size={16} /> Leave
                  </button>
                  <button className="btn btn-green" onClick={() => setShowLogin(true)}>
                    <LogIn size={16} /> Log in
                  </button>
                </div>
              </section>
            )}

            {identity && (
            <section className="card">
              <div className="section-head">
                <div className="section-title">Admin access</div>
                <span className={`pill ${isAdminUnlocked ? 'pill-green' : 'pill-red'}`}>
                  {isAdminUnlocked ? (
                    <>
                      <Unlock size={12} /> Unlocked
                    </>
                  ) : (
                    <>
                      <Lock size={12} /> Locked
                    </>
                  )}
                </span>
              </div>
              {!isAdminUnlocked ? (
                !pinCreated ? (
                  <p className="muted small-copy">The admin PIN has not been created yet for this room.</p>
                ) : (
                  <form
                    className="stack-list"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void unlockAdmin();
                    }}
                  >
                    <p className="muted small-copy">Enter the room PIN to run the clock and record knockouts from this phone.</p>
                    <input type="password" inputMode="numeric" placeholder="Admin PIN" value={accessPinInput} onChange={(e) => setAccessPinInput(e.target.value)} autoComplete="off" />
                    <button type="submit" className="btn btn-green btn-block" disabled={!accessPinInput.trim()}>
                      <KeyRound size={16} /> Unlock admin controls
                    </button>
                  </form>
                )
              ) : (
                <>
                  <p className="muted small-copy">This phone controls the tournament. Takeovers and releases are logged.</p>
                  <div className="btn-pair">
                    <button className="btn btn-dark" onClick={() => setShowChangePinBox((v) => !v)}>
                      <Settings2 size={16} /> Change PIN
                    </button>
                    <button className="btn btn-red" onClick={releaseAdmin}>
                      Release
                    </button>
                  </div>
                  {showChangePinBox && (
                    <form
                      className="input-row"
                      style={{ marginTop: 10 }}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void changeAdminPin();
                      }}
                    >
                      <input type="password" inputMode="numeric" placeholder="New PIN" value={newPinInput} onChange={(e) => setNewPinInput(e.target.value)} autoComplete="off" />
                      <button type="submit" className="btn btn-green">
                        Save
                      </button>
                    </form>
                  )}
                </>
              )}
            </section>
            )}

            <section className="card">
              <div className="section-title">Theme</div>
              <ThemePicker />
            </section>

            <section className="card">
              <div className="section-title">Blinds-up sound</div>
              <div className="segmented" style={{ marginBottom: 8 }}>
                {(
                  [
                    ['song', '🎵 Song'],
                    ['fanfare', '🎺 Fanfare'],
                    ['doot', '💀 Doot'],
                  ] as [LevelSound, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={(room.settings.levelSound ?? 'song') === value ? 'active' : ''}
                    onClick={() => setLevelSound(value)}
                    disabled={!isAdminUnlocked}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {toneList.length > 0 && (
                <>
                  <div className="sub-label" style={{ marginTop: 4 }}>
                    Player tones
                  </div>
                  <div className="chip-grid">
                    {toneList.map((tone) => (
                      <button
                        key={tone.uid}
                        type="button"
                        className={`select-chip ${(room.settings.levelSound ?? 'song') === toneSound(tone.uid) ? 'selected' : ''}`}
                        onClick={() => setLevelSound(toneSound(tone.uid))}
                        disabled={!isAdminUnlocked}
                      >
                        🎧 {tone.name} <span className="muted">· {tone.ownerName}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <p className="tiny muted" style={{ margin: '8px 0 0' }}>
                Now: <strong>{soundLabel(room.settings.levelSound ?? 'song')}</strong>.{' '}
                {isAdminUnlocked ? 'Plays on every phone when the blinds go up.' : 'Chosen by the admin for this room.'}
              </p>
            </section>

            {identity && (
              <section className="card">
                <div className="section-title">My blinds-up tone</div>
                <ToneUploader user={identity} myTone={toneList.find((t) => t.uid === identity.uid)} onMessage={setAdminMessage} />
              </section>
            )}

            <section className="card">
              <div className="section-head">
                <div className="section-title">Blind alerts on this phone</div>
                <span className={`pill ${alertsEnabled ? 'pill-green' : ''}`}>{alertsEnabled ? 'On' : 'Off'}</span>
              </div>
              <p className="muted small-copy">
                Chime + vibration when blinds go up, a warning 1 minute before, and a notification if the app is in the background. The screen stays
                awake while the clock runs.
              </p>
              <button className={`btn btn-block ${alertsEnabled ? 'btn-dark' : 'btn-gold'}`} onClick={toggleAlerts}>
                {alertsEnabled ? <BellOff size={16} /> : <Bell size={16} />} {alertsEnabled ? 'Turn alerts off' : 'Turn alerts on'}
              </button>
              {alertsEnabled && (
                <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={previewAlert}>
                  Test blinds-up (countdown, voice, sound)
                </button>
              )}
              <p className="tiny muted" style={{ marginBottom: 0 }}>
                iPhone: add this site to your Home Screen to get notifications. Turn off silent mode for sound.
              </p>
            </section>

            {identity && (
            <section className="card">
              <div className="section-title">Account</div>
              <p className="muted small-copy">Signed in as {identity.displayName}</p>
              <div className="btn-pair">
                <button className="btn btn-dark" onClick={leaveRoom}>
                  <DoorOpen size={16} /> Leave room
                </button>
                <button className="btn btn-dark" onClick={logoutAccount}>
                  <LogOut size={16} /> Log out
                </button>
              </div>
            </section>
            )}
          </>
        )}
      </main>

      <nav className="bottom-nav">
        <button className={roomTab === 'table' ? 'active' : ''} onClick={() => setRoomTab('table')}>
          {phase === 'end' ? <Trophy size={22} /> : <Spade size={22} />}
          <span>{phaseLabel}</span>
        </button>
        <button className={roomTab === 'log' ? 'active' : ''} onClick={() => setRoomTab('log')}>
          <ScrollText size={22} />
          <span>Log</span>
        </button>
        <button className={roomTab === 'history' ? 'active' : ''} onClick={() => setRoomTab('history')}>
          <HistoryIcon size={22} />
          <span>History</span>
        </button>
        <button className={roomTab === 'room' ? 'active' : ''} onClick={() => setRoomTab('room')}>
          {isAdminUnlocked ? <Unlock size={22} /> : <Lock size={22} />}
          <span>Room</span>
        </button>
      </nav>

      {toast}

      {needsPinSetup && isAdminUnlocked && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-body">
              <div className="modal-title">Create admin PIN</div>
              <p className="modal-copy muted">You created this room, so this phone is the admin. Set the PIN other phones use to take admin access.</p>
              <label>New admin PIN</label>
              <input type="password" inputMode="numeric" value={setupPinInput} onChange={(e) => setSetupPinInput(e.target.value)} placeholder="At least 4 characters" autoComplete="off" />
              <label>Confirm admin PIN</label>
              <input type="password" inputMode="numeric" value={setupPinConfirmInput} onChange={(e) => setSetupPinConfirmInput(e.target.value)} placeholder="Re-enter PIN" autoComplete="off" />
              {setupPinError && <div className="note-box error">{setupPinError}</div>}
            </div>
            <div className="modal-actions">
              <button className="btn btn-green" onClick={saveInitialAdminPin}>
                Save PIN
              </button>
            </div>
          </div>
        </div>
      )}

      {elimModal && isAdminUnlocked && (() => {
        const remainingPlayers = activePlayers.filter((p) => !selectedEliminatedIds.includes(p.id));
        const bustIndex = typeof koStep === 'number' ? koStep : -1;
        const bustId = bustIndex >= 0 ? selectedEliminatedIds[bustIndex] : null;
        const bustName = players.find((p) => p.id === bustId)?.name ?? '';
        const prevBustId = bustIndex > 0 ? selectedEliminatedIds[bustIndex - 1] : null;
        const takers = bustId ? bustedBy[bustId] ?? [] : [];
        const totalSteps = selectedEliminatedIds.length + 2;
        const stepNo = koStep === 'hand' ? totalSteps : bustIndex + 2;
        const gains = bountyGains();

        const goBack = () => {
          if (koStep === 'hand') setKoStep(selectedEliminatedIds.length - 1);
          else if (bustIndex >= 0) setKoStep(bustIndex - 1);
        };
        const goNext = () => {
          if (bustIndex < selectedEliminatedIds.length - 1) setKoStep(bustIndex + 1);
          else setKoStep('hand');
        };
        const canNext = koStep === -1 ? selectedEliminatedIds.length > 0 : takers.length > 0;

        return (
          <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !isRecordingKnockout && setElimModal(false)}>
            <div className="modal-card">
              <div className="modal-head">
                <div>
                  <div className="modal-title">
                    {koStep === -1 ? 'Who is out?' : koStep === 'hand' ? 'Finish knockout' : `Who knocked out ${bustName}?`}
                  </div>
                  <div className="step-dots" aria-label={`Step ${stepNo} of ${totalSteps}`}>
                    {Array.from({ length: totalSteps }, (_, i) => (
                      <span key={i} className={i < stepNo ? 'on' : ''} />
                    ))}
                  </div>
                </div>
                <button className="icon-btn" onClick={() => setElimModal(false)} disabled={isRecordingKnockout} aria-label="Close">
                  <X size={20} />
                </button>
              </div>

              <div className="modal-body">
                {koStep === -1 && (
                  <>
                    <div className="tiny muted step-hint">Tap everyone who busted in this hand.</div>
                    <div className="pick-grid">
                      {activePlayers.map((p) => (
                        <button
                          type="button"
                          key={`out-${p.id}`}
                          className={`pick-btn out ${selectedEliminatedIds.includes(p.id) ? 'selected' : ''}`}
                          onClick={() => toggleEliminated(p.id)}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {bustId && (
                  <>
                    <div className="tiny muted step-hint">
                      €{fmt(bounty)} bounty · tap the winner. Split pot? Tap more than one.
                    </div>
                    {prevBustId && (bustedBy[prevBustId] ?? []).length > 0 && (
                      <button type="button" className="btn btn-dark btn-block same-btn" onClick={() => copyBustedBy(prevBustId, bustId)}>
                        Same as last: {(bustedBy[prevBustId] ?? []).map((id) => players.find((p) => p.id === id)?.name).join(' & ')}
                      </button>
                    )}
                    <div className="pick-grid">
                      {remainingPlayers.map((p) => (
                        <button
                          type="button"
                          key={`by-${bustId}-${p.id}`}
                          className={`pick-btn win ${takers.includes(p.id) ? 'selected' : ''}`}
                          onClick={() => toggleBustedBy(bustId, p.id)}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                    {takers.length > 1 && (
                      <div className="tiny muted step-hint" style={{ marginTop: 8 }}>
                        Split {takers.length} ways · €{fmt(bounty / takers.length)} each
                      </div>
                    )}
                  </>
                )}

                {koStep === 'hand' && (
                  <>
                    <div className="sub-label" style={{ marginTop: 0 }}>
                      Winning hand
                    </div>
                    <div className="hand-grid">
                      {WINNING_HANDS.map((hand) => (
                        <button
                          type="button"
                          key={hand}
                          className={`pick-btn ${winningHand === hand ? 'selected hand' : ''}`}
                          onClick={() => setWinningHand(hand)}
                        >
                          {hand}
                        </button>
                      ))}
                    </div>

                    {buyinsClosed ? (
                      <div className="note-box">Buy-ins are closed — no rebuys.</div>
                    ) : (
                      <>
                        <div className="sub-label">Rebuy (+€{fmt(buyIn)} buy-in)</div>
                        <div className="stack-list">
                          {selectedEliminatedIds.map((id) => {
                            const player = players.find((p) => p.id === id);
                            return (
                              <button
                                key={`rebuy-${id}`}
                                type="button"
                                role="checkbox"
                                aria-checked={wantsRebuy(id)}
                                className={`rebuy-toggle ${wantsRebuy(id) ? 'active' : ''}`}
                                onClick={() => toggleRebuyFor(id)}
                              >
                                <span className="check" aria-hidden="true">
                                  {wantsRebuy(id) ? '✓' : ''}
                                </span>
                                <span className="rebuy-name">{player?.name} rebuys</span>
                                <strong>{wantsRebuy(id) ? `+€${fmt(buyIn)}` : 'No rebuy'}</strong>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}

                    <div className="bounty-summary">
                      {Object.entries(gains).map(([id, amount]) => (
                        <div key={`gain-${id}`}>
                          <span>{players.find((p) => p.id === id)?.name}</span>
                          <strong>+€{fmt(amount)}</strong>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {knockoutError && (
                  <div className="note-box error" role="alert">
                    {knockoutError}
                  </div>
                )}
              </div>

              <div className="modal-actions">
                {koStep === -1 ? (
                  <button className="btn btn-dark" onClick={() => setElimModal(false)} disabled={isRecordingKnockout}>
                    Cancel
                  </button>
                ) : (
                  <button className="btn btn-dark" onClick={goBack} disabled={isRecordingKnockout}>
                    Back
                  </button>
                )}
                {koStep === 'hand' ? (
                  <button className="btn btn-red" onClick={confirmElimination} disabled={isRecordingKnockout || !knockoutReady}>
                    {isRecordingKnockout ? 'Recording…' : 'Confirm'}
                  </button>
                ) : (
                  <button className="btn btn-green" onClick={goNext} disabled={!canNext}>
                    Next
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {phase === 'game' && showPayoutModal && activePlayers.length <= FINISH_ALLOWED_AT && isAdminUnlocked && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setShowPayoutModal(false)}>
          <div className="modal-card">
            <div className="modal-head">
              <div className="modal-title">Finish tournament</div>
              <button className="icon-btn" onClick={() => setShowPayoutModal(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-copy muted">
                Prize pool <strong className="gold">€{fmt(prizePool)}</strong> · {players.length} players · default {defaultPlaces(players.length)} paid
                places. Edit any amount.
              </p>
              <div className="places-bar">
                <button className="btn btn-dark" onClick={() => changePlaces(-1)} disabled={payoutMode <= 1} aria-label="Remove a place">
                  −
                </button>
                <div className="places-count">
                  <strong>{payoutMode}</strong> paid {payoutMode === 1 ? 'place' : 'places'}
                </div>
                <button className="btn btn-dark" onClick={() => changePlaces(1)} disabled={payoutMode >= MAX_PLACES} aria-label="Add a place">
                  +
                </button>
              </div>
              <button className="btn btn-ghost btn-block reset-split" onClick={() => applyDefaultPayouts(payoutMode)}>
                Reset to default split ({(PAYOUT_SPLITS[payoutMode] ?? []).join(' / ')}%)
              </button>
              {PAYOUT_KEYS.slice(0, payoutMode).map((key) => (
                <div className="payout-card" key={key}>
                  <div className="payout-place">
                    <span>{PLACE_META[key].emoji}</span>
                    <span>{PLACE_META[key].label}</span>
                    {prizePool > 0 && Number(payouts[key]) > 0 && (
                      <span className="payout-pct">{Math.round((Number(payouts[key]) / prizePool) * 100)}%</span>
                    )}
                  </div>
                  <select value={finishers[key]} onChange={(e) => setFinishers((prev) => ({ ...prev, [key]: e.target.value }))}>
                    <option value="">Select player</option>
                    {players
                      .filter((p) => {
                        const selectedElsewhere = PAYOUT_KEYS.filter((otherKey) => otherKey !== key).some((otherKey) => finishers[otherKey] === p.id);
                        return !selectedElsewhere || finishers[key] === p.id;
                      })
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.active ? '(active)' : '(out)'}
                        </option>
                      ))}
                  </select>
                  <div className="money-input">
                    <span>€</span>
                    <input type="number" inputMode="decimal" min="0" step="1" placeholder="0" value={payouts[key]} onChange={(e) => updatePayoutValue(key, e.target.value)} />
                  </div>
                </div>
              ))}
            </div>
            <div className="remaining-box">
              <span>Remaining to assign</span>
              <strong className={remaining === 0 ? 'green' : remaining < 0 ? 'red' : 'gold'}>€{fmt(remaining)}</strong>
            </div>
            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => setShowPayoutModal(false)}>
                Close
              </button>
              <button className="btn btn-green" disabled={remaining !== 0} onClick={finishTournament}>
                Finish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
