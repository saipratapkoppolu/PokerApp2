import { useState } from 'react';
import { ChevronLeft, ChevronRight, Shield, UserPlus, Users, X } from 'lucide-react';
import type { PlayerGroup, UserIdentity, UserProfile } from '../types/app';
import {
  MAX_GROUP_NAME,
  addGroupMembers,
  createGroup,
  deleteGroup,
  groupMembers,
  hasMemberNamed,
  isGroupAdmin,
  removeGroupMember,
  renameGroup,
  renameGroupMember,
  setGroupAdmin,
} from '../utils/groups';
import { normalizeName, sameName } from '../utils/format';
import { createPoll } from '../utils/polls';
import { useAvatars } from '../hooks/useAvatars';
import { avatarColor, findAccounts } from '../utils/profile';
import MemberProfileSheet from './MemberProfileSheet';

const pad = (n: number) => String(n).padStart(2, '0');

/** Tonight (or tomorrow, if 8 PM has passed), as a date input's value. */
function nextEveningDate() {
  const d = new Date();
  if (d.getHours() >= 20) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Opens the browser's date or time picker on tap, where it has one (not every browser opens it by itself). */
function openPicker(e: React.MouseEvent<HTMLInputElement>) {
  try {
    e.currentTarget.showPicker?.();
  } catch {
    // Not allowed here: the field still takes typing.
  }
}

type Props = {
  identity: UserIdentity;
  registeredUsers: UserProfile[];
  groups: PlayerGroup[];
  onNotice: (message: string) => void;
};

/** Groups (like WhatsApp groups): members + admins. Admins add/remove members and choose other admins. */
export default function GroupsPage({ identity, registeredUsers, groups, onNotice }: Props) {
  const [openId, setOpenId] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const open = groups.find((g) => g.id === openId);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await action();
      if (done) onNotice(done);
    } catch (error) {
      console.error('group change failed', error);
      onNotice('Could not save the group change — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (open) return <GroupDetail group={open} identity={identity} registeredUsers={registeredUsers} busy={busy} run={run} onBack={() => setOpenId('')} />;

  return (
    <>
      <section className="card">
        <div className="section-head">
          <div className="section-title">Your groups</div>
          <span className="pill">{groups.length}</span>
        </div>
        {groups.length === 0 ? (
          <div className="empty-state">
            <Users size={26} />
            <div>No groups yet. Create one for your poker crew.</div>
          </div>
        ) : (
          <div className="stack-list">
            {groups.map((g) => (
              <button className="history-row" key={g.id} onClick={() => setOpenId(g.id)}>
                <div className="history-main">
                  <div className="player-name">{g.name}</div>
                  <div className="tiny muted">
                    {Object.keys(g.members ?? {}).length} members{isGroupAdmin(g, identity.uid) ? ' · you are admin' : ''}
                  </div>
                </div>
                <ChevronRight size={18} className="muted" />
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-title">New group</div>
        <form
          className="input-row"
          onSubmit={(e) => {
            e.preventDefault();
            const name = normalizeName(newName);
            if (!name) return;
            void run(async () => {
              const id = await createGroup(name, identity);
              setNewName('');
              setOpenId(id);
            }, `Group “${name}” created.`);
          }}
        >
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Group name" maxLength={MAX_GROUP_NAME} autoComplete="off" />
          <button type="submit" className="btn btn-green" disabled={busy || !normalizeName(newName)}>
            Create
          </button>
        </form>
      </section>
    </>
  );
}

function GroupDetail({
  group,
  identity,
  registeredUsers,
  busy,
  run,
  onBack,
}: {
  group: PlayerGroup;
  identity: UserIdentity;
  registeredUsers: UserProfile[];
  busy: boolean;
  run: (action: () => Promise<unknown>, done?: string) => Promise<void>;
  onBack: () => void;
}) {
  // Ticked accounts, from your other groups or found by name.
  const [picked, setPicked] = useState<UserProfile[]>([]);
  const [accountName, setAccountName] = useState('');
  const [searched, setSearched] = useState<{ name: string; found: UserProfile[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [pollTitle, setPollTitle] = useState('');
  const [pollDate, setPollDate] = useState(nextEveningDate);
  const [pollTime, setPollTime] = useState('20:00');
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(group.name);

  const amAdmin = isGroupAdmin(group, identity.uid);
  // You first, then everyone else by name.
  const members = [...groupMembers(group)].sort((a, b) => Number(b.key === identity.uid) - Number(a.key === identity.uid));
  // The member whose profile is open (accounts only).
  const [shownUid, setShownUid] = useState('');
  const shownMember = members.find((m) => m.uid === shownUid);
  const photos = useAvatars(
    members.flatMap((m) => (m.uid ? [m.uid] : [])),
    registeredUsers
  );
  const adminCount = Object.keys(group.admins ?? {}).length;
  // Not in the group yet (by uid or by the same name).
  const canAdd = (u: UserProfile) => !group.members?.[u.uid] && !hasMemberNamed(group, u.displayName);
  // People from your other groups (nobody can browse every account).
  const candidates = registeredUsers.filter(canAdd);
  const found = (searched?.found ?? []).filter(canAdd);
  const isPicked = (u: UserProfile) => picked.some((p) => p.uid === u.uid);
  const togglePicked = (u: UserProfile) => setPicked((prev) => (isPicked(u) ? prev.filter((p) => p.uid !== u.uid) : [...prev, u]));
  const findAccount = async () => {
    const name = normalizeName(accountName);
    if (!name || searching) return;
    setSearching(true);
    try {
      setSearched({ name, found: await findAccounts(name) });
    } catch (error) {
      console.warn('account search failed', error);
      setSearched({ name, found: [] });
    } finally {
      setSearching(false);
    }
  };
  const accountChip = (u: UserProfile) => (
    <button key={u.uid} type="button" className={`select-chip ${isPicked(u) ? 'selected' : ''}`} onClick={() => togglePicked(u)} title={u.status || undefined}>
      {isPicked(u) ? '+ ' : ''}
      {u.displayName}
    </button>
  );
  const me = group.members?.[identity.uid];
  // The last admin can't leave while others remain: someone must be able to manage the group.
  const lastAdminWithOthers = amAdmin && adminCount === 1 && members.length > 1;

  const addPicked = () => {
    // Accounts appear under their display name (the same in every group).
    const accounts = picked.map((u) => ({ uid: u.uid, name: u.displayName }));
    void run(async () => {
      await addGroupMembers(group.id, accounts, []);
      setPicked([]);
    }, `Added ${accounts.length} member${accounts.length === 1 ? '' : 's'}.`);
  };

  const addGuest = () => {
    const name = normalizeName(guestName);
    if (!name) return;
    if (hasMemberNamed(group, name)) {
      void run(async () => undefined, `${name} is already in the group.`);
      return;
    }
    void run(async () => {
      await addGroupMembers(group.id, [], [name]);
      setGuestName('');
    }, `Added ${name}.`);
  };

  const leave = () => {
    if (!me) return;
    if (members.length === 1) {
      if (!window.confirm(`You are the last member. Leaving deletes “${group.name}”. Continue?`)) return;
      void run(() => deleteGroup(group), 'Group deleted.').then(onBack);
      return;
    }
    if (!window.confirm(`Leave “${group.name}”?`)) return;
    void run(() => removeGroupMember(group.id, identity.uid, me), 'You left the group.').then(onBack);
  };

  return (
    <>
      <button className="btn btn-ghost" style={{ marginBottom: 12 }} onClick={onBack}>
        <ChevronLeft size={16} /> All groups
      </button>

      <section className="card">
        <div className="section-title">Group</div>
        {renaming ? (
          <form
            className="input-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!normalizeName(title)) return;
              void run(() => renameGroup(group.id, title), 'Group renamed.').then(() => setRenaming(false));
            }}
          >
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={MAX_GROUP_NAME} autoComplete="off" autoFocus />
            <button type="submit" className="btn btn-green" disabled={busy || !normalizeName(title)}>
              Save
            </button>
          </form>
        ) : (
          <div className="section-head">
            <div className="tournament-name">{group.name}</div>
            {amAdmin && (
              <button
                className="link-btn"
                onClick={() => {
                  setTitle(group.name);
                  setRenaming(true);
                }}
              >
                Rename
              </button>
            )}
          </div>
        )}
        <div className="tiny muted">Created by {group.createdBy?.displayName ?? 'someone'}</div>
      </section>

      <section className="card">
        <div className="section-title">Ask who’s in</div>
        <form
          className="stack-list"
          onSubmit={(e) => {
            e.preventDefault();
            const startsAt = new Date(`${pollDate}T${pollTime}`).getTime();
            if (!normalizeName(pollTitle) || !startsAt) return;
            void run(() => createPoll(group.id, pollTitle, startsAt, identity), 'Poll posted.').then(() => setPollTitle(''));
          }}
        >
          <input value={pollTitle} onChange={(e) => setPollTitle(e.target.value)} placeholder="Title, like Friday Poker" maxLength={40} autoComplete="off" />
          <div className="input-row">
            <input type="date" aria-label="Date" value={pollDate} onChange={(e) => setPollDate(e.target.value)} onClick={openPicker} />
            <input type="time" aria-label="Time" value={pollTime} onChange={(e) => setPollTime(e.target.value)} onClick={openPicker} />
          </div>
          <button type="submit" className="btn btn-green" disabled={busy || !normalizeName(pollTitle)}>
            Post
          </button>
        </form>
        <div className="tiny muted">Everyone in the group sees it on Home and answers In, Buy-in or Out.</div>
      </section>

      <section className="card">
        <div className="section-head">
          <div className="section-title">Members</div>
          <span className="pill">{members.length}</span>
        </div>
        <div className="stack-list">
          {members.map((m) => {
            const isAdmin = !!m.uid && isGroupAdmin(group, m.uid);
            const isMe = m.uid === identity.uid;
            return (
              <div className="player-row" key={m.key}>
                <span
                  className={`member-avatar${m.uid ? ' tappable' : ''}`}
                  onClick={m.uid ? () => setShownUid(m.uid!) : undefined}
                  style={{ background: avatarColor(m.key) }}
                  aria-hidden="true"
                >
                  {m.uid && photos[m.uid] ? (
                    <img src={photos[m.uid]} alt="" />
                  ) : (
                    m.name
                      .split(' ')
                      .slice(0, 2)
                      .map((w) => w[0] ?? '')
                      .join('')
                      .toUpperCase()
                  )}
                </span>
                <span
                  className={`player-name${m.uid ? ' tappable' : ''}`}
                  onClick={m.uid ? () => setShownUid(m.uid!) : undefined}
                >
                  {m.name}
                  {isMe && <span className="tiny muted"> (you)</span>}
                  {!m.uid && <span className="tiny muted"> · no account</span>}
                </span>
                {isAdmin && (
                  <span className="pill pill-green">
                    <Shield size={12} /> Admin
                  </span>
                )}
                {amAdmin && !isMe && !m.uid && (
                  <button
                    className="link-btn"
                    disabled={busy}
                    onClick={() => {
                      const raw = window.prompt('New name', m.name);
                      const name = normalizeName(raw ?? '');
                      if (!name || name === m.name) return;
                      if (members.some((o) => o.key !== m.key && sameName(o.name, name))) {
                        window.alert(`${name} is already in the group.`);
                        return;
                      }
                      // Only people without an account: accounts always show their display name.
                      void run(() => renameGroupMember(m.key, name, [group.id]), `Renamed to ${name}.`);
                    }}
                  >
                    Rename
                  </button>
                )}
                {amAdmin && !isMe && m.uid && (
                  <button className="link-btn" disabled={busy} onClick={() => void run(() => setGroupAdmin(group.id, m.uid!, !isAdmin), isAdmin ? `${m.name} is no longer admin.` : `${m.name} is now admin.`)}>
                    {isAdmin ? 'Remove admin' : 'Make admin'}
                  </button>
                )}
                {amAdmin && !isMe && (
                  <button
                    className="icon-btn"
                    disabled={busy}
                    aria-label={`Remove ${m.name}`}
                    onClick={() => {
                      if (window.confirm(`Remove ${m.name} from “${group.name}”?`)) void run(() => removeGroupMember(group.id, m.key, m), `${m.name} removed.`);
                    }}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {amAdmin && (
        <section className="card">
          <div className="section-title">Add members</div>
          <div className="sub-label" style={{ marginTop: 0 }}>
            Find an account
          </div>
          <form
            className="input-row"
            onSubmit={(e) => {
              e.preventDefault();
              void findAccount();
            }}
          >
            <input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="Their exact display name"
              autoComplete="off"
              autoCapitalize="none"
              maxLength={40}
            />
            <button type="submit" className="btn btn-ghost" disabled={searching || !normalizeName(accountName)}>
              Find
            </button>
          </form>
          <div className="tiny muted" style={{ marginTop: 6 }}>
            Type their display name exactly as it is in the app. Nobody can browse every account.
          </div>
          {searched && (
            <div style={{ marginTop: 10 }}>
              {found.length === 0 ? (
                <div className="tiny muted">No account is called “{searched.name}”.</div>
              ) : (
                <div className="chip-grid">{found.map(accountChip)}</div>
              )}
            </div>
          )}
          {candidates.length > 0 && (
            <>
              <div className="sub-label">From your groups</div>
              <div className="chip-grid">{candidates.map(accountChip)}</div>
            </>
          )}
          {picked.length > 0 && (
            <div className="btn-pair" style={{ marginTop: 10 }}>
              <button className="btn btn-ghost" onClick={() => setPicked([])}>
                Clear
              </button>
              <button className="btn btn-green" disabled={busy} onClick={addPicked}>
                <UserPlus size={16} /> Add {picked.length}
              </button>
            </div>
          )}
          <div className="sub-label">Someone without an account</div>
          <form
            className="input-row"
            onSubmit={(e) => {
              e.preventDefault();
              addGuest();
            }}
          >
            <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Name" maxLength={MAX_GROUP_NAME} autoComplete="off" />
            <button type="submit" className="btn btn-green" disabled={busy || !normalizeName(guestName)}>
              Add
            </button>
          </form>
        </section>
      )}

      <section className="card">
        {lastAdminWithOthers && <div className="tiny muted" style={{ marginBottom: 10 }}>You are the only admin — make someone else admin before you leave.</div>}
        <div className="btn-pair">
          <button className="btn btn-ghost" disabled={busy || !me || lastAdminWithOthers} onClick={leave}>
            Leave group
          </button>
          {amAdmin && (
            <button
              className="btn btn-red"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete “${group.name}” for everyone? This can't be undone.`)) void run(() => deleteGroup(group), 'Group deleted.').then(onBack);
              }}
            >
              Delete group
            </button>
          )}
        </div>
      </section>
      {shownMember?.uid && (
        <MemberProfileSheet
          uid={shownMember.uid}
          name={shownMember.name}
          profile={registeredUsers.find((u) => u.uid === shownMember.uid)}
          photo={photos[shownMember.uid]}
          onClose={() => setShownUid('')}
        />
      )}
    </>
  );
}
