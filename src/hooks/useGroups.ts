import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '../firebase';
import type { PlayerGroup } from '../types/app';

/** The groups this account is in (userGroups/{uid}), each kept live; sorted by name. */
export function useGroups(uid: string | undefined): PlayerGroup[] {
  const [ids, setIds] = useState<string[]>([]);
  const [groups, setGroups] = useState<Record<string, PlayerGroup>>({});

  useEffect(() => {
    setIds([]);
    if (!uid) return;
    return onValue(
      ref(db, `userGroups/${uid}`),
      (snap) => setIds(Object.keys(snap.val() ?? {}).sort()),
      (error) => console.warn('Group list unavailable', error)
    );
  }, [uid]);

  const idKey = ids.join(',');
  useEffect(() => {
    // Keep groups still on the list (no flicker); forget the rest.
    const keep = new Set(idKey ? idKey.split(',') : []);
    setGroups((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => keep.has(id))));
    if (!idKey) return;
    const drop = (id: string) =>
      setGroups((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    const unsubs = idKey.split(',').map((id) =>
      onValue(
        ref(db, `groups/${id}`),
        (snap) => {
          const value = snap.val() as Omit<PlayerGroup, 'id'> | null;
          if (value) setGroups((prev) => ({ ...prev, [id]: { ...value, id } }));
          else drop(id);
        },
        // Removed from the group (no longer allowed to read it).
        () => drop(id)
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [idKey]);

  return Object.values(groups).sort((a, b) => a.name.localeCompare(b.name));
}
