import { updateProfile } from 'firebase/auth';
import { equalTo, get, limitToFirst, orderByChild, query, ref, update } from 'firebase/database';
import { auth, db } from '../firebase';
import type { UserProfile } from '../types/app';
import { makeNameKey, normalizeName } from './format';

/** Profiles, the same as Profiles.swift on iOS. */
export const MAX_STATUS = 80;
export const MIN_NAME = 2;
const PHOTO_SIDE = 256;

export const profileStatus = (raw: string) => normalizeName(raw).slice(0, MAX_STATUS);

/** Another account already has this display name (names are unique: usernames/ in the database rules). */
export class NameTakenError extends Error {
  constructor() {
    super('That name is taken. Choose another.');
    this.name = 'NameTakenError';
  }
}

/** The name's entry in usernames/: its name key with the characters a database key can't hold written as %XX.
 *  The same as Profiles.usernameKey on iOS and in the database rules. */
export function usernameKey(name: string) {
  return makeNameKey(name)
    .replace(/%/g, '%25')
    .replace(/\./g, '%2E')
    .replace(/#/g, '%23')
    .replace(/\$/g, '%24')
    .replace(/\[/g, '%5B')
    .replace(/\]/g, '%5D')
    .replace(/\//g, '%2F');
}

/** Who has this name in usernames/, if anyone. */
async function nameOwner(key: string): Promise<string | null> {
  const snap = await get(ref(db, `usernames/${key}`));
  return typeof snap.val() === 'string' ? snap.val() : null;
}

/** Nobody else has this name (in usernames/, or, signed in, on an older profile that never claimed it). `uid`:
 *  whoever is asking, whose own name counts as free; undefined before the account exists. */
export async function isNameAvailable(name: string, uid?: string): Promise<boolean> {
  const key = usernameKey(name);
  if (!key) return false;
  const owner = await nameOwner(key);
  if (owner) return owner === uid;
  if (!uid) return true;
  return (await findAccounts(name)).every((profile) => profile.uid === uid);
}

/** Claims your current name when nobody has (accounts made before names were unique); quiet when someone has. */
export async function claimName(uid: string, displayName: string) {
  const key = usernameKey(displayName);
  if (!key || !(await isNameAvailable(displayName, uid)) || (await nameOwner(key))) return;
  await update(ref(db), { [`usernames/${key}`]: uid }).catch(() => undefined);
}

/** One write; refused by the rules when the name is someone else's by then. */
async function writeClaimed(values: Record<string, unknown>, name: string, uid: string) {
  try {
    await update(ref(db), values);
  } catch (error) {
    if (!(await isNameAvailable(name, uid))) throw new NameTakenError();
    throw error;
  }
}

/** A new account's profile, with its name claimed in the same write. */
export async function createProfile(profile: UserProfile) {
  await writeClaimed(
    { [`users/${profile.uid}`]: profile, [`usernames/${usernameKey(profile.displayName)}`]: profile.uid },
    profile.displayName,
    profile.uid,
  );
}

/** A name nobody has yet, from this one: "Sam", else "Sam 2", "Sam 3", … */
export async function freeName(base: string, uid: string): Promise<string> {
  const name = normalizeName(base) || 'Player';
  for (let n = 1; n < 50; n += 1) {
    const candidate = n === 1 ? name : `${name} ${n}`;
    if (await isNameAvailable(candidate, uid)) return candidate;
  }
  return `${name} ${Date.now() % 100000}`;
}

/** Your display name (account and profile) and status. A new name is claimed and the old one let go in the same
 *  write; throws NameTakenError when another account has it. Your groups pick up the name automatically. */
export async function saveProfile(uid: string, displayName: string, status: string) {
  const name = normalizeName(displayName);
  const tidy = profileStatus(status);
  const key = usernameKey(name);
  const values: Record<string, unknown> = {
    [`users/${uid}/displayName`]: name,
    [`users/${uid}/displayNameKey`]: makeNameKey(name),
    [`users/${uid}/status`]: tidy || null,
  };
  const current = (await get(ref(db, `users/${uid}/displayName`))).val();
  const oldKey = typeof current === 'string' ? usernameKey(current) : '';
  if (oldKey !== key) {
    if (!(await isNameAvailable(name, uid))) throw new NameTakenError();
    if (oldKey && (await nameOwner(oldKey)) === uid) values[`usernames/${oldKey}`] = null;
  }
  if (!(await nameOwner(key))) values[`usernames/${key}`] = uid;
  await writeClaimed(values, name, uid);
  if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: name });
  return name;
}

/** Accounts whose display name is exactly this (ignoring case and spaces). The only list query the rules allow:
 *  nobody can browse every account. */
export async function findAccounts(name: string): Promise<UserProfile[]> {
  const key = makeNameKey(name);
  if (!key) return [];
  const snap = await get(query(ref(db, 'users'), orderByChild('displayNameKey'), equalTo(key), limitToFirst(5)));
  const value = (snap.val() ?? {}) as Record<string, UserProfile>;
  return Object.entries(value).map(([uid, profile]) => ({ ...profile, uid }));
}

export async function loadPhoto(uid: string): Promise<string | null> {
  const snap = await get(ref(db, `avatars/${uid}`));
  return typeof snap.val() === 'string' ? snap.val() : null;
}

/** A picked image: the middle square, 256 px, as a JPEG data URL (small enough for the database). */
export function squarePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = PHOTO_SIDE;
      canvas.height = PHOTO_SIDE;
      canvas.getContext('2d')?.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, PHOTO_SIDE, PHOTO_SIDE);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('not an image'));
    };
    img.src = url;
  });
}

/** Your profile picture, or null to remove it. */
export function savePhoto(uid: string, dataUrl: string | null) {
  return update(ref(db), { [`avatars/${uid}`]: dataUrl, [`users/${uid}/photoUpdatedAt`]: dataUrl ? Date.now() : null });
}

/** The same eight muted colours as the iOS app's avatars. */
const AVATAR_COLORS = ['#3E6E8C', '#8C4A3E', '#5B7A45', '#6E4F8A', '#8A6B3A', '#3E7F74', '#8A3E5E', '#555F6E'];

/** A person's colour behind their initials: from their uid or member key, the same one every time (as on iOS). */
export function avatarColor(seed: string) {
  let sum = 0;
  for (let i = 0; i < seed.length; i += 1) sum += seed.charCodeAt(i);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}
