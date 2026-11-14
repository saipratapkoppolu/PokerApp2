import { useEffect, useState } from 'react';
import type { Player } from '../types/app';
import { cachedPhoto } from '../utils/photoCache';

/** A player's picture: their account's (the login saved with the player), when it has one; otherwise their suit. */
export default function PlayerIcon({ player }: { player: Player }) {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setPhoto(null);
    if (player.uid) void cachedPhoto(player.uid).then((p) => current && setPhoto(p));
    return () => {
      current = false;
    };
  }, [player.uid]);
  if (photo) return <img className="player-photo" src={photo} alt="" />;
  return <span className={`suit ${player.suit === '♥' || player.suit === '♦' ? 'red' : ''}`}>{player.suit}</span>;
}
