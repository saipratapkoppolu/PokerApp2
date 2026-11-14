import { useEffect, useState } from 'react';
import type { PlayerGroup } from '../types/app';
import { loadGroupPhoto } from '../utils/groups';
import { avatarColor } from '../utils/profile';

/** The group's picture (loaded again when someone changes it), else its initials. */
export function useGroupPhoto(group: PlayerGroup) {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void loadGroupPhoto(group).then((p) => current && setPhoto(p));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, group.photoUpdatedAt]);
  return group.photoUpdatedAt ? photo : null;
}

export const groupInitials = (name: string) =>
  name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();

/** A small round group picture, for the groups list. */
export default function GroupPhoto({ group }: { group: PlayerGroup }) {
  const photo = useGroupPhoto(group);
  return (
    <span className="member-avatar" style={{ background: avatarColor(group.id) }} aria-hidden="true">
      {photo ? <img src={photo} alt="" /> : groupInitials(group.name)}
    </span>
  );
}
