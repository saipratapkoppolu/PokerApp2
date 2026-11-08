import { updateProfile } from 'firebase/auth';
import { get, ref, update } from 'firebase/database';
import { auth, db } from '../firebase';
import { makeNameKey, normalizeName } from './format';

/** Profiles, the same as Profiles.swift on iOS. */
export const MAX_STATUS = 80;
export const MIN_NAME = 2;
const PHOTO_SIDE = 256;

export const profileStatus = (raw: string) => normalizeName(raw).slice(0, MAX_STATUS);

/** Your display name (account and profile) and status. Your groups pick up the name automatically. */
export async function saveProfile(uid: string, displayName: string, status: string) {
  const name = normalizeName(displayName);
  const tidy = profileStatus(status);
  if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: name });
  await update(ref(db, `users/${uid}`), { displayName: name, displayNameKey: makeNameKey(name), status: tidy || null });
  return name;
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
