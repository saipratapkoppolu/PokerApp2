import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '../firebase';
import type { GamePoll, PlayerGroup } from '../types/app';

/** Polls from all your groups, kept live, soonest first. */
export function usePolls(groups: PlayerGroup[]): GamePoll[] {
  const [byGroup, setByGroup] = useState<Record<string, GamePoll[]>>({});
  const idKey = groups.map((g) => g.id).sort().join(',');

  useEffect(() => {
    const ids = idKey ? idKey.split(',') : [];
    setByGroup((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.includes(id))));
    const unsubs = ids.map((groupId) =>
      onValue(
        ref(db, `groupPolls/${groupId}`),
        (snap) => {
          const value = (snap.val() ?? {}) as Record<string, Omit<GamePoll, 'id' | 'groupId'>>;
          const polls = Object.entries(value).map(([id, poll]) => ({ ...poll, id, groupId }));
          setByGroup((prev) => ({ ...prev, [groupId]: polls }));
        },
        () => setByGroup((prev) => ({ ...prev, [groupId]: [] }))
      )
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [idKey]);

  return Object.values(byGroup)
    .flat()
    .sort((a, b) => a.startsAt - b.startsAt);
}
