import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import type { HistoryItem } from '../types/app';

/**
 * The games this account may see, from the app's worker (GET /visible): the database rules can't filter a list, so
 * nobody reads all of history/ or rooms/. Finished games and the codes of games in progress, refreshed every minute
 * and when the tab comes back while something listens. The history is kept in this browser (per account) for offline.
 * Same as VisibleGames.swift on iOS.
 */
export type VisibleGames = { history: HistoryItem[]; live: string[] };

const WORKER = (import.meta.env.VITE_SPLITWISE_WORKER_URL ?? '').trim().replace(/\/+$/, '');
const REFRESH_EVERY_MS = 60_000;
const EMPTY: VisibleGames = { history: [], live: [] };

const listeners = new Set<(games: VisibleGames) => void>();
let latest: { uid: string | null; games: VisibleGames } | null = null;
let timer: number | undefined;
let stopAuth: (() => void) | undefined;

const cacheKey = (uid: string) => `poker.visibleHistory.${uid}`;

function saved(uid: string): VisibleGames | null {
  try {
    const raw = localStorage.getItem(cacheKey(uid));
    return raw ? { history: JSON.parse(raw) as HistoryItem[], live: [] } : null;
  } catch {
    return null;
  }
}

function deliver(uid: string | null, games: VisibleGames) {
  latest = { uid, games };
  listeners.forEach((listener) => listener(games));
}

export async function refreshVisible() {
  const user = auth.currentUser;
  if (!user) {
    deliver(null, EMPTY);
    return;
  }
  if (!WORKER) return;
  try {
    const token = await user.getIdToken();
    const res = await fetch(`${WORKER}/visible`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!res.ok) return;
    const answer = (await res.json()) as VisibleGames;
    // Signed out or into another account while waiting: this answer is someone else's.
    if (auth.currentUser?.uid !== user.uid) return;
    const history = [...(answer.history ?? [])].sort((a, b) => b.completedAt - a.completedAt);
    try {
      localStorage.setItem(cacheKey(user.uid), JSON.stringify(history));
    } catch {
      // Storage full or blocked: still shown, just not kept.
    }
    deliver(user.uid, { history, live: answer.live ?? [] });
  } catch (error) {
    console.warn('visible games read failed', error);
  }
}

const onVisible = () => {
  if (document.visibilityState === 'visible') void refreshVisible();
};

/** Delivers what is known now (this account's saved history while offline), then each refresh. */
export function subscribeVisible(onChange: (games: VisibleGames) => void): () => void {
  listeners.add(onChange);
  const uid = auth.currentUser?.uid ?? null;
  if (latest && latest.uid === uid) onChange(latest.games);
  else if (uid) {
    const known = saved(uid);
    if (known) onChange(known);
  } else onChange(EMPTY);
  if (listeners.size === 1) {
    void refreshVisible();
    timer = window.setInterval(() => void refreshVisible(), REFRESH_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    // Signing in or out changes what you may see.
    stopAuth = onAuthStateChanged(auth, () => void refreshVisible());
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size > 0) return;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    stopAuth?.();
  };
}
