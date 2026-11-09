import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';
import { ref, remove, set } from 'firebase/database';
import app, { auth, db } from '../firebase';

/** Push notifications on this browser (Firebase Cloud Messaging), sent by the worker (splitwise-worker/src/push.js). */

/** The Web Push certificate's public key (Firebase → Cloud Messaging); not a secret. */
const VAPID_KEY = 'BIamBF-ZvkjWiGpfjPQFp0JSmP6qv0mkhZpFZ2u-xb4_Y64HQHsKywFNrm5fWCP5T5mTGPckrm2qt87zQ8MXW-s';
const WORKER = (import.meta.env.VITE_SPLITWISE_WORKER_URL ?? '').trim().replace(/\/+$/, '');
const KEY_STORE = 'poker.pushTokenKey';

export const pushSupported = async () =>
  'Notification' in window && 'serviceWorker' in navigator && (await isSupported().catch(() => false));

/** The token's key in pushTokens/{uid}: a hash, so the token itself isn't a database path. */
async function tokenKey(token: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Registers this browser for your notifications. `ask`: show the permission prompt (needs a tap). */
export async function enablePush(uid: string, ask: boolean): Promise<boolean> {
  if (!(await pushSupported())) return false;
  if (Notification.permission !== 'granted') {
    if (!ask || (await Notification.requestPermission()) !== 'granted') return false;
  }
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) return false;
  const key = await tokenKey(token);
  await set(ref(db, `pushTokens/${uid}/${key}`), { token, platform: 'web', updatedAt: Date.now() });
  localStorage.setItem(KEY_STORE, key);
  return true;
}

/** Signing out: this browser stops getting that account's notifications. */
export async function disablePush(uid: string) {
  const key = localStorage.getItem(KEY_STORE);
  localStorage.removeItem(KEY_STORE);
  if (key) await remove(ref(db, `pushTokens/${uid}/${key}`)).catch(() => {});
  if (await pushSupported()) await deleteToken(getMessaging(app)).catch(() => {});
}

/** Asks the worker to notify about something you just did (it checks and builds the message itself). */
export async function notifyEvent(body: { event: 'poll' | 'game' | 'added' | 'test'; groupId?: string; pollId?: string; roomId?: string; uids?: string[] }): Promise<number> {
  const user = auth.currentUser;
  if (!WORKER || !user) return 0;
  try {
    const res = await fetch(`${WORKER}/notify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return ((await res.json().catch(() => ({}))) as { sent?: number }).sent ?? 0;
  } catch (error) {
    console.warn('notify failed', error);
    return 0;
  }
}
