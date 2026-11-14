import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus, Search, UserPlus } from 'lucide-react';
import type { Player, UserProfile } from '../types/app';
import { makeNameKey, normalizeName, sameName } from '../utils/format';
import { MIN_NAME, findAccounts } from '../utils/profile';
import AccountPhoto from './AccountPhoto';

/** How long typing pauses before the account search, and how long that search may take. */
const PAUSE_MS = 400;
const TIMEOUT_MS = 5000;

type Result = { uid: string; name: string; status?: string };

type Props = {
  /** The accounts in your groups (nobody can list every account): the results as you type. */
  groupAccounts: UserProfile[];
  players: Player[];
  disabled: boolean;
  full: boolean;
  /** Adds a player; `uid` is their account (none for a guest). */
  onAdd: (name: string, uid?: string) => void | Promise<void>;
};

/** "Add registered player", as on iOS (PlayerSearchSheet): people from your groups whose name matches show as you
 *  type, and after a short pause the account with exactly that name is looked up, with a spinner while it searches.
 *  Tap a result to add them with their account. A name nobody has can be added as a guest. */
export default function RegisteredPlayerSearch({ groupAccounts, players, disabled, full, onAdd }: Props) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<{ key: string; results: Result[]; failed: boolean } | null>(null);
  const latest = useRef('');

  const name = normalizeName(query);
  const key = makeNameKey(query);

  useEffect(() => {
    latest.current = key;
    if (name.length < MIN_NAME) {
      setSearching(false);
      setFound({ key, results: [], failed: false });
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      const search: Promise<Result[] | null> = offline
        ? Promise.resolve(null)
        : findAccounts(name)
            .then((profiles) =>
              profiles.filter((p) => p.uid).map((p) => ({ uid: p.uid, name: p.displayName, status: p.status })),
            )
            .catch(() => null);
      const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), TIMEOUT_MS));
      void Promise.race([search, timeout]).then((results) => {
        if (latest.current !== key) return; // An older search: the name has changed since.
        setFound({ key, results: results ?? [], failed: results === null });
        setSearching(false);
      });
    }, PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [key, name]);

  const fromGroups: Result[] = groupAccounts
    .filter((u) => u.uid && (!key || makeNameKey(u.displayName).includes(key)))
    .map((u) => ({ uid: u.uid, name: u.displayName, status: u.status }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const foundNow = found?.key === key ? found.results : [];
  const results = [...fromGroups, ...foundNow.filter((r) => !fromGroups.some((g) => g.uid === r.uid))];
  const searched = found?.key === key && !searching;
  const failed = searched && !!found?.failed;
  const noMatch = !!name && searched && results.length === 0;

  const playing = (r: Result) => players.some((p) => p.uid === r.uid);
  const nameInUse = (r: Result) => !playing(r) && players.some((p) => sameName(p.name, r.name));

  async function addGuest() {
    await onAdd(name);
    setQuery('');
  }

  return (
    <div className="player-search">
      <label className="search-field">
        <Search size={16} aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={disabled ? 'Unlock admin to add' : 'Player’s full name'}
          disabled={disabled}
          autoComplete="off"
          aria-label="Search registered players"
        />
      </label>

      {results.length > 0 && (
        <div className="stack-list search-results">
          {results.map((r) => {
            const isPlaying = playing(r);
            const inUse = nameInUse(r);
            return (
              <button
                key={r.uid}
                type="button"
                className="player-row search-result"
                onClick={() => void onAdd(r.name, r.uid)}
                disabled={disabled || full || isPlaying || inUse}
              >
                <AccountPhoto uid={r.uid} />
                <span className="player-name">
                  {r.name}
                  {inUse ? (
                    <span className="search-note danger">Someone called this is already playing.</span>
                  ) : (
                    r.status && <span className="search-note">{r.status}</span>
                  )}
                </span>
                {isPlaying ? <Check size={18} aria-label="Playing" /> : <Plus size={18} aria-hidden />}
              </button>
            );
          })}
        </div>
      )}

      {searching && name && (
        <div className="search-status" role="status">
          <Loader2 size={16} className="spin" aria-hidden /> Searching for “{name}”…
        </div>
      )}

      {(noMatch || (failed && !!name)) && (
        <div className="search-status">
          <span className="muted">
            {failed ? 'Couldn’t search right now. Check your connection, or add them as a guest.' : `Nobody is registered as “${name}”.`}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => void addGuest()} disabled={disabled || full}>
            <UserPlus size={16} /> Add “{name}” as a guest
          </button>
        </div>
      )}

      {!name && results.length === 0 && (
        <div className="muted search-hint">Type their full name, as on their profile. People from your groups show as you type.</div>
      )}
    </div>
  );
}
