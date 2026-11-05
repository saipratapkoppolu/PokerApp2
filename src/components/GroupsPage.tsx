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
  setGroupAdmin,
} from '../utils/groups';
import { normalizeName } from '../utils/format';

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
  const [picked, setPicked] = useState<string[]>([]);
  const [guestName, setGuestName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(group.name);

  const amAdmin = isGroupAdmin(group, identity.uid);
  const members = groupMembers(group);
  const adminCount = Object.keys(group.admins ?? {}).length;
  // Accounts not in the group yet (by uid or by the same name).
  const candidates = registeredUsers.filter((u) => !group.members?.[u.uid] && !hasMemberNamed(group, u.displayName));
  // Search by name; accounts already ticked stay shown.
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const shown = query ? candidates.filter((u) => picked.includes(u.uid) || u.displayName.toLowerCase().includes(query)) : candidates;
  const me = group.members?.[identity.uid];
  // The last admin can't leave while others remain: someone must be able to manage the group.
  const lastAdminWithOthers = amAdmin && adminCount === 1 && members.length > 1;

  const addPicked = () => {
    const accounts = registeredUsers.filter((u) => picked.includes(u.uid)).map((u) => ({ uid: u.uid, name: u.displayName }));
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
                <span className="player-name">
                  {m.name}
                  {isMe && <span className="tiny muted"> (you)</span>}
                  {!m.uid && <span className="tiny muted"> · no account</span>}
                </span>
                {isAdmin && (
                  <span className="pill pill-green">
                    <Shield size={12} /> Admin
                  </span>
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
          {candidates.length > 0 && (
            <>
              <div className="sub-label" style={{ marginTop: 0 }}>
                App accounts
              </div>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search accounts"
                autoComplete="off"
                style={{ marginBottom: 10 }}
              />
              {shown.length === 0 && <div className="tiny muted" style={{ marginBottom: 10 }}>No accounts match “{search.trim()}”.</div>}
              <div className="chip-grid">
                {shown.map((u) => {
                  const selected = picked.includes(u.uid);
                  return (
                    <button
                      key={u.uid}
                      type="button"
                      className={`select-chip ${selected ? 'selected' : ''}`}
                      onClick={() => setPicked((prev) => (selected ? prev.filter((x) => x !== u.uid) : [...prev, u.uid]))}
                    >
                      {selected ? '+ ' : ''}
                      {u.displayName}
                    </button>
                  );
                })}
              </div>
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
            </>
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
    </>
  );
}
