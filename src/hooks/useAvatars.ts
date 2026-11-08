import { useEffect, useState } from 'react';
import type { UserProfile } from '../types/app';
import { loadPhoto } from '../utils/profile';

/** Profile pictures (data URLs) by uid for these accounts, loaded once each and again when they change. */
export function useAvatars(uids: string[], profiles: UserProfile[]): Record<string, string> {
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const wanted = profiles.filter((p) => p.photoUpdatedAt && uids.includes(p.uid));
  const key = wanted.map((p) => `${p.uid}:${p.photoUpdatedAt}`).join(',');

  useEffect(() => {
    let cancelled = false;
    for (const entry of key ? key.split(',') : []) {
      const uid = entry.split(':')[0];
      void loadPhoto(uid).then((photo) => {
        if (!cancelled && photo) setPhotos((prev) => ({ ...prev, [uid]: photo }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [key]);

  return photos;
}
