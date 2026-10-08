import { useEffect, useState } from 'react';
import { SPLITWISE_GROUP_ID } from '../config/splitwise';
import { fetchSplitwiseGroups, getSplitwiseSession, splitwiseApiEnabled, type SplitwiseMember } from '../utils/splitwise';

/**
 * Members of the poker Splitwise group, when this device is connected to Splitwise.
 * null = not available (not connected, not in the group, or Splitwise unreachable).
 * Without a configured group ID nobody is listed (see TipCard).
 */
export function useSplitwiseMembers(enabled: boolean): SplitwiseMember[] | null {
  const [members, setMembers] = useState<SplitwiseMember[] | null>(null);

  useEffect(() => {
    if (!enabled || !SPLITWISE_GROUP_ID || !splitwiseApiEnabled || !getSplitwiseSession()) return;
    let live = true;
    fetchSplitwiseGroups()
      .then((groups) => {
        const members = groups.find((g) => g.id === SPLITWISE_GROUP_ID)?.members ?? [];
        if (live) setMembers(members.length ? [...members].sort((a, b) => a.name.localeCompare(b.name)) : null);
      })
      .catch(() => {
        if (live) setMembers(null);
      });
    return () => {
      live = false;
    };
  }, [enabled]);

  return members;
}
