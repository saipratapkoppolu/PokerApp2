import type { UserProfile } from '../types/app';
import { avatarColor } from '../utils/profile';

type Props = {
  uid: string;
  /** Their name in the group, until the profile is known. */
  name: string;
  profile?: UserProfile;
  photo?: string;
  onClose: () => void;
};

/** Someone's profile, read-only: picture, display name and status, in a bottom sheet. */
export default function MemberProfileSheet({ uid, name, profile, photo, onClose }: Props) {
  const displayName = profile?.displayName ?? name;
  const initials = displayName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
  return (
    <div className="modal-backdrop bottom" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-label={displayName} onClick={(e) => e.stopPropagation()}>
        <div className="modal-body profile-card">
          <div className="profile-avatar" style={{ background: avatarColor(uid) }}>
            {photo ? <img src={photo} alt="" /> : <span>{initials}</span>}
          </div>
          <div className="modal-title">{displayName}</div>
          <div className={profile?.status ? '' : 'muted'}>{profile?.status || 'No status yet'}</div>
          <button className="btn btn-ghost btn-block" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
