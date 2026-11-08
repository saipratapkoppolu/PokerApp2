import { useEffect, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { get, ref } from 'firebase/database';
import { db } from '../firebase';
import type { UserIdentity } from '../types/app';
import { normalizeName } from '../utils/format';
import { MAX_STATUS, MIN_NAME, avatarColor, loadPhoto, profileStatus, savePhoto, saveProfile, squarePhoto } from '../utils/profile';

type Props = {
  identity: UserIdentity;
  onSaved: (displayName: string) => void;
  onBack: () => void;
  onLogOut: () => void;
  onNotice: (message: string) => void;
};

/** Your profile: picture, display name (how you appear everywhere) and status. */
export default function ProfilePage({ identity, onSaved, onBack, onLogOut, onNotice }: Props) {
  const [name, setName] = useState(identity.displayName);
  const [status, setStatus] = useState('');
  const [saved, setSaved] = useState({ name: identity.displayName, status: '' });
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void get(ref(db, `users/${identity.uid}/status`)).then((snap) => {
      const value = typeof snap.val() === 'string' ? snap.val() : '';
      setStatus(value);
      setSaved((s) => ({ ...s, status: value }));
    });
    void loadPhoto(identity.uid).then(setPhoto);
  }, [identity.uid]);

  const valid = normalizeName(name).length >= MIN_NAME;
  const changed = normalizeName(name) !== saved.name || profileStatus(status) !== saved.status;
  const initials = normalizeName(name)
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();

  async function save() {
    if (!valid) return onNotice(`Your display name needs at least ${MIN_NAME} characters.`);
    setBusy(true);
    try {
      const savedName = await saveProfile(identity.uid, name, status);
      setSaved({ name: savedName, status: profileStatus(status) });
      setName(savedName);
      onSaved(savedName);
      onNotice('Profile saved.');
    } catch (error) {
      console.error('profile save failed', error);
      onNotice('Couldn’t save your profile. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await squarePhoto(file);
      await savePhoto(identity.uid, dataUrl);
      setPhoto(dataUrl);
    } catch {
      onNotice('Couldn’t use that photo. Try another.');
    }
  }

  return (
    <>
      <button className="btn btn-ghost" style={{ marginBottom: 12 }} onClick={onBack}>
        <ChevronLeft size={16} /> Settings
      </button>
      <section className="card profile-card">
        <div className="profile-avatar" style={{ background: avatarColor(identity.uid) }}>{photo ? <img src={photo} alt="" /> : <span>{initials}</span>}</div>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
        <div className="input-row" style={{ justifyContent: 'center' }}>
          <button className="link-btn" style={{ marginLeft: 0 }} onClick={() => fileInput.current?.click()}>
            {photo ? 'Change photo' : 'Add photo'}
          </button>
          {photo && (
            <button className="link-btn" onClick={() => void savePhoto(identity.uid, null).then(() => setPhoto(null))}>
              Remove photo
            </button>
          )}
        </div>
      </section>
      <section className="card">
        <div className="section-title">Display name</div>
        <div className="stack-list">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="nickname" />
          <input value={status} onChange={(e) => setStatus(e.target.value)} maxLength={MAX_STATUS} placeholder="Status, like Free on Fridays" />
          <button className="btn btn-green" disabled={busy || !valid || !changed} onClick={() => void save()}>
            Save
          </button>
        </div>
        <div className="tiny muted">Your display name is how you appear in every group, poll and game.</div>
      </section>
      <section className="card">
        <div className="section-title">Account</div>
        <button className="btn btn-ghost btn-block" onClick={onLogOut}>
          Log out
        </button>
      </section>
    </>
  );
}
