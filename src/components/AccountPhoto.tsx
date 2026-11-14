import { useEffect, useState } from 'react';
import { cachedPhoto } from '../utils/photoCache';

/** The account's picture (by login), small and round; nothing when it has none. */
export default function AccountPhoto({ uid }: { uid?: string }) {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setPhoto(null);
    if (uid) void cachedPhoto(uid).then((p) => current && setPhoto(p));
    return () => {
      current = false;
    };
  }, [uid]);
  return photo ? <img className="player-photo" src={photo} alt="" /> : null;
}
