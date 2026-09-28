import { useEffect, useState } from 'react';
import { SPLITWISE_GROUP_ID, SPLITWISE_PLAYER_IDS } from '../config/splitwise';
import { fmt } from '../utils/format';
import {
  SPLITWISE_URL,
  SplitwiseAuthError,
  clearSplitwiseSession,
  connectSplitwise,
  createSplitwiseExpense,
  fetchSplitwiseGroups,
  fetchSplitwiseMe,
  getSplitwiseSession,
  takeSplitwiseLoginError,
  guessMember,
  settleUp,
  splitwiseApiEnabled,
  splitwiseText,
  type SplitwiseGroup,
  type SplitwiseRow,
} from '../utils/splitwise';

type Added = { expenseId: number; groupName: string; addedBy: string };

type Props = {
  title: string;
  rows: SplitwiseRow[];
  onMessage: (message: string) => void;
  /** Unlocked room admin AND in SPLITWISE_ADDERS (src/config/splitwise.ts). */
  canAdd?: boolean;
  added?: Added;
  onAdded?: (info: { expenseId: number; groupName: string }) => void | Promise<void>;
};

const GROUP_KEY = 'poker.splitwiseGroup';
const MAP_KEY = 'poker.splitwiseMembers';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked — the picks just aren't remembered.
  }
}

const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/** Config IDs keyed the same way as player names. */
const configIds: Record<string, number> = Object.fromEntries(
  Object.entries(SPLITWISE_PLAYER_IDS).map(([name, id]) => [nameKey(name), id]),
);

/** Results-page card: spent / earned / net per player, settle-up list, copy/share for Splitwise. */
export default function SplitwiseCard({ title, rows, onMessage, canAdd, added, onAdded }: Props) {
  const transfers = settleUp(rows);
  const [groups, setGroups] = useState<SplitwiseGroup[] | null>(null);
  const [groupId, setGroupId] = useState<number>(0);
  const [memberFor, setMemberFor] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Splitwise account this device is connected to: '' = not connected, null = checking.
  const [me, setMe] = useState<string | null>(null);
  const group = groups?.find((g) => g.id === groupId);
  const showAdd = splitwiseApiEnabled && canAdd && !added;

  useEffect(() => {
    if (!showAdd) return;
    const loginError = takeSplitwiseLoginError();
    if (loginError)
      setError(
        loginError === 'access_denied' || loginError === 'cancelled'
          ? 'Splitwise login cancelled.'
          : 'Splitwise login failed — try again.',
      );
    if (!getSplitwiseSession()) {
      setMe('');
      return;
    }
    let live = true;
    fetchSplitwiseMe()
      .then((name) => live && setMe(name))
      .catch((e) => {
        if (!live) return;
        setMe(e instanceof SplitwiseAuthError ? '' : 'your Splitwise account');
        if (!(e instanceof SplitwiseAuthError)) setError(e instanceof Error ? e.message : 'Could not reach Splitwise.');
      });
    return () => {
      live = false;
    };
  }, [showAdd]);

  function fail(e: unknown, fallback: string) {
    if (e instanceof SplitwiseAuthError) {
      setMe('');
      setGroups(null);
    }
    setError(e instanceof Error ? e.message : fallback);
  }

  function disconnect() {
    clearSplitwiseSession();
    setMe('');
    setGroups(null);
    setError('');
  }

  function pickGroup(id: number, list = groups ?? []) {
    setGroupId(id);
    const g = list.find((x) => x.id === id);
    if (!g) return;
    // Remembered pick for this name (if still in the group), else a name match.
    const remembered = load<Record<string, number>>(MAP_KEY, {});
    const next: Record<string, number> = {};
    const inGroup = (id?: number) => (id && g.members.some((m) => m.id === id) ? id : undefined);
    // Order: src/config/splitwise.ts → last pick on this device → name match.
    rows.forEach((r) => {
      const key = nameKey(r.name);
      const id2 = inGroup(configIds[key]) ?? inGroup(remembered[key]) ?? guessMember(r.name, g.members);
      if (id2) next[r.id] = id2;
    });
    setMemberFor(next);
  }

  async function openAdd() {
    setBusy(true);
    setError('');
    try {
      const all = await fetchSplitwiseGroups();
      // A group ID in src/config/splitwise.ts locks the expense to that one group.
      const list = SPLITWISE_GROUP_ID ? all.filter((g) => g.id === SPLITWISE_GROUP_ID) : all;
      if (!list.length) {
        setError(
          SPLITWISE_GROUP_ID
            ? `Your Splitwise account isn't in group ${SPLITWISE_GROUP_ID} (src/config/splitwise.ts).`
            : 'No Splitwise groups found in your account.',
        );
        return;
      }
      setGroups(list);
      const last = load<number>(GROUP_KEY, 0);
      pickGroup(list.some((g) => g.id === last) ? last : list[0].id, list);
    } catch (e) {
      fail(e, 'Could not reach Splitwise.');
    } finally {
      setBusy(false);
    }
  }

  const allMapped = rows.every((r) => memberFor[r.id]);

  async function addExpense() {
    if (!group || !allMapped || busy) return;
    setBusy(true);
    setError('');
    try {
      const expenseId = await createSplitwiseExpense({ groupId: group.id, title, rows, memberFor });
      save(GROUP_KEY, group.id);
      const remembered = load<Record<string, number>>(MAP_KEY, {});
      rows.forEach((r) => (remembered[nameKey(r.name)] = memberFor[r.id]));
      save(MAP_KEY, remembered);
      await onAdded?.({ expenseId, groupName: group.name });
      setGroups(null);
      onMessage(`Added to Splitwise (${group.name}).`);
    } catch (e) {
      fail(e, 'Could not add the expense.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(splitwiseText(title, new Date(), rows));
      onMessage('Copied for Splitwise — paste it into the expense notes.');
    } catch {
      onMessage('Could not copy — long-press the numbers instead.');
    }
  }

  async function share() {
    if (!navigator.share) return copy();
    try {
      await navigator.share({ title: `Poker: ${title}`, text: splitwiseText(title, new Date(), rows) });
    } catch {
      /* user cancelled */
    }
  }

  function renderAdd() {
    if (me === null) return <div className="tiny muted splitwise-me">Checking Splitwise…</div>;
    if (me === '') {
      return (
        <button className="btn btn-green btn-block splitwise-add-btn" onClick={connectSplitwise}>
          Connect Splitwise
        </button>
      );
    }
    if (!groups) {
      return (
        <>
          <button className="btn btn-green btn-block splitwise-add-btn" onClick={openAdd} disabled={busy}>
            {busy ? 'Loading groups…' : 'Add to Splitwise'}
          </button>
          <div className="tiny muted splitwise-me">
            Connected as {me} ·{' '}
            <button className="link-btn" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        </>
      );
    }
    return (
      <div className="splitwise-add">
        <label className="tiny muted" htmlFor="sw-group">
          Splitwise group
        </label>
        {groups.length === 1 ? (
          <div className="splitwise-group" id="sw-group">
            {groups[0].name}
          </div>
        ) : (
          <select id="sw-group" value={groupId} onChange={(e) => pickGroup(Number(e.target.value))}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
        {group &&
          rows.map((r) => (
            <div className="splitwise-map" key={r.id}>
              <span className="splitwise-name">{r.name}</span>
              <select
                aria-label={`Splitwise person for ${r.name}`}
                value={memberFor[r.id] ?? ''}
                onChange={(e) => setMemberFor((prev) => ({ ...prev, [r.id]: Number(e.target.value) }))}
              >
                <option value="">Pick…</option>
                {group.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        <div className="splitwise-actions two">
          <button className="btn btn-dark" onClick={() => setGroups(null)} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-green" onClick={addExpense} disabled={busy || !allMapped}>
            {busy ? 'Adding…' : 'Create expense'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="card">
      <div className="section-title">Splitwise</div>
      <p className="tiny muted splitwise-help">
        Add one expense: <strong>Paid by multiple people</strong> = Earned, <strong>Split unequally</strong> = Spent.
      </p>
      <div className="splitwise-table">
        <div className="splitwise-row head">
          <span>Player</span>
          <span>Spent</span>
          <span>Earned</span>
          <span>Net</span>
        </div>
        {rows.map((r) => (
          <div className="splitwise-row" key={r.id}>
            <span className="splitwise-name">{r.name}</span>
            <span>€{fmt(r.spent)}</span>
            <span>€{fmt(r.earned)}</span>
            <strong className={r.net > 0 ? 'plus' : r.net < 0 ? 'minus' : ''}>
              {r.net > 0 ? '+' : r.net < 0 ? '−' : ''}€{fmt(Math.abs(r.net))}
            </strong>
          </div>
        ))}
      </div>
      {transfers.length > 0 && (
        <div className="splitwise-transfers">
          <div className="tiny muted">Settle up</div>
          {transfers.map((t, i) => (
            <div className="tiny" key={i}>
              {t.from} → {t.to} <strong>€{fmt(t.amount)}</strong>
            </div>
          ))}
        </div>
      )}
      {added ? (
        <div className="note-box splitwise-added">
          ✓ Added to Splitwise ({added.groupName}) by {added.addedBy}
        </div>
      ) : (
        showAdd && renderAdd()
      )}
      {error && <div className="note-box error splitwise-error">{error}</div>}
      <div className="splitwise-actions">
        <button className="btn btn-dark" onClick={copy}>
          Copy
        </button>
        <button className="btn btn-dark" onClick={share}>
          Share
        </button>
        <a className="btn btn-dark" href={SPLITWISE_URL} target="_blank" rel="noreferrer">
          Open Splitwise
        </a>
      </div>
    </section>
  );
}
