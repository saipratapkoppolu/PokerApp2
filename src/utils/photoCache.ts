import { loadPhoto } from './profile';

/** Each account's picture (by login), loaded once per page. */
const photos = new Map<string, Promise<string | null>>();

export function cachedPhoto(uid: string) {
  let photo = photos.get(uid);
  if (!photo) {
    photo = loadPhoto(uid).catch(() => null);
    photos.set(uid, photo);
  }
  return photo;
}
