import { SPLITWISE_ADDERS, SPLITWISE_GROUP_ID } from '../config/splitwise';
import { fmt } from './format';

/**
 * Splitwise export for a finished tournament.
 *
 * One Splitwise expense settles the whole game:
 *   - "Paid by"  (paid share)  = what each player EARNED (prize + bounties won)
 *   - "Split"    (owed share)  = what each player SPENT  (buy-ins + bounties lost)
 * Splitwise balance = paid − owed = the player's net, so the group ends up owing
 * exactly the right amounts. Both columns add up to the same total.
 *
 * The Splitwise API can't be called from the browser (no CORS, OAuth needs a
 * secret), so the app prepares the numbers and the text; the admin pastes them
 * into Splitwise.
 */

export type SplitwiseRow = {
  id: string;
  name: string;
  spent: number;
  earned: number;
  net: number;
};

export type Transfer = { from: string; to: string; amount: number };

const cents = (n: number) => Math.round(n * 100);

export function splitwiseRows(
  players: { id: string; name: string; buyins: number; bountyBalance: number }[],
  buyIn: number,
  prizeFor: (id: string) => number,
): SplitwiseRow[] {
  const rows = players.map((p) => {
    const bounty = p.bountyBalance || 0;
    const spentC = cents(p.buyins * buyIn + Math.max(0, -bounty));
    const earnedC = cents(prizeFor(p.id) + Math.max(0, bounty));
    return { id: p.id, name: p.name, spentC, earnedC };
  });
  // Split bounties (e.g. thirds) can leave a cent of rounding; give it to the biggest earner
  // so both columns match to the cent, as Splitwise requires.
  const diff = rows.reduce((s, r) => s + r.spentC - r.earnedC, 0);
  if (diff !== 0 && Math.abs(diff) <= rows.length) {
    const top = rows.reduce((a, b) => (b.earnedC > a.earnedC ? b : a), rows[0]);
    if (top) top.earnedC += diff;
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    spent: r.spentC / 100,
    earned: r.earnedC / 100,
    net: (r.earnedC - r.spentC) / 100,
  }));
}

/** Fewest "X pays Y" transfers that settle every net. */
export function settleUp(rows: SplitwiseRow[]): Transfer[] {
  const debtors = rows.filter((r) => r.net < 0).map((r) => ({ name: r.name, c: -cents(r.net) }));
  const creditors = rows.filter((r) => r.net > 0).map((r) => ({ name: r.name, c: cents(r.net) }));
  debtors.sort((a, b) => b.c - a.c);
  creditors.sort((a, b) => b.c - a.c);
  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].c, creditors[j].c);
    if (amount > 0) out.push({ from: debtors[i].name, to: creditors[j].name, amount: amount / 100 });
    debtors[i].c -= amount;
    creditors[j].c -= amount;
    if (debtors[i].c === 0) i++;
    if (creditors[j].c === 0) j++;
  }
  return out;
}

const money = (n: number) => `€${fmt(Math.round(n * 100) / 100)}`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;

/** Plain-text expense description to paste into Splitwise (notes / description). */
export function splitwiseText(title: string, date: Date, rows: SplitwiseRow[]): string {
  const total = rows.reduce((s, r) => s + r.spent, 0);
  const lines = [
    `🃏 Poker: ${title} (${date.toLocaleDateString()})`,
    `Total ${money(total)}`,
    '',
    'Paid by (earned):',
    ...rows.filter((r) => r.earned > 0).map((r) => `  ${r.name}: ${money(r.earned)}`),
    '',
    'Split unequally (spent):',
    ...rows.map((r) => `  ${r.name}: ${money(r.spent)}`),
    '',
    'Net:',
    ...rows.map((r) => `  ${r.name}: ${signed(r.net)}`),
  ];
  const transfers = settleUp(rows);
  if (transfers.length) {
    lines.push('', 'Settle up:', ...transfers.map((t) => `  ${t.from} → ${t.to}: ${money(t.amount)}`));
  }
  return lines.join('\n');
}

/** "Open Splitwise": the configured group, else the dashboard. */
export const SPLITWISE_URL = SPLITWISE_GROUP_ID
  ? `https://secure.splitwise.com/#/groups/${SPLITWISE_GROUP_ID}`
  : 'https://secure.splitwise.com/#/dashboard';

// ---------------------------------------------------------------------------
// "Connect Splitwise": each admin logs in with their own Splitwise account through the
// Cloudflare Worker in splitwise-worker/ (it keeps the app secret and forwards calls).
// The browser only stores an encrypted session that is useless without the worker.

const WORKER_URL = (import.meta.env.VITE_SPLITWISE_WORKER_URL ?? '').replace(/\/+$/, '');
export const splitwiseApiEnabled = WORKER_URL !== '';

const SESSION_KEY = 'poker.splitwiseSession';

export function getSplitwiseSession(): string {
  try {
    return localStorage.getItem(SESSION_KEY) ?? '';
  } catch {
    return '';
  }
}

export function clearSplitwiseSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked — nothing to clear.
  }
}

/**
 * After the Splitwise login the worker sends the browser back with ?sw_session=… (or ?sw_error=…).
 * Store it and strip it from the address bar. Call once at startup. Returns the error, if any.
 */
let loginError = '';

/** The error from the last Splitwise login redirect (read once). */
export function takeSplitwiseLoginError(): string {
  const e = loginError;
  loginError = '';
  return e;
}

export function takeSplitwiseLoginResult(): string {
  const url = new URL(window.location.href);
  const session = url.searchParams.get('sw_session');
  const error = url.searchParams.get('sw_error') ?? '';
  if (!session && !error) return '';
  loginError = error;
  if (session) {
    try {
      localStorage.setItem(SESSION_KEY, session);
    } catch {
      // Storage blocked — the user will have to connect again next time.
    }
  }
  url.searchParams.delete('sw_session');
  url.searchParams.delete('sw_error');
  window.history.replaceState(null, '', url.toString());
  return error;
}

/** Full-page redirect to Splitwise's login; comes back to this exact page (same room). */
export function connectSplitwise() {
  window.location.href = `${WORKER_URL}/login?return=${encodeURIComponent(window.location.href)}`;
}

export class SplitwiseAuthError extends Error {}

const adderKeys = new Set(SPLITWISE_ADDERS.map((n) => n.trim().toLowerCase()));

/** Whether this logged-in user may use "Add to Splitwise" (see src/config/splitwise.ts). */
export const canAddToSplitwise = (displayName?: string | null) =>
  !!displayName && adderKeys.has(displayName.trim().toLowerCase());

export type SplitwiseMember = { id: number; name: string };
export type SplitwiseGroup = { id: number; name: string; members: SplitwiseMember[] };

type ApiUser = { id: number; first_name?: string | null; last_name?: string | null };

const memberName = (u: ApiUser) => [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || `User ${u.id}`;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${WORKER_URL}/api/${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${getSplitwiseSession()}` },
  });
  const body = await res.json().catch(() => null);
  if (res.status === 401) {
    clearSplitwiseSession();
    throw new SplitwiseAuthError('Splitwise login expired — connect again.');
  }
  if (!res.ok || !body)
    throw new Error(`Splitwise: ${(body as { error?: string } | null)?.error ?? `HTTP ${res.status}`}`);
  return body as T;
}

/** The logged-in Splitwise user's name (shown as "Connected as …"). */
export async function fetchSplitwiseMe(): Promise<string> {
  const data = await api<{ user: ApiUser }>('get_current_user');
  return memberName(data.user);
}

/** The connected user's groups (without the built-in "Non-group expenses"). */
export async function fetchSplitwiseGroups(): Promise<SplitwiseGroup[]> {
  const data = await api<{ groups: { id: number; name: string; members: ApiUser[] }[] }>('get_groups');
  return data.groups
    .filter((g) => g.id !== 0)
    .map((g) => ({ id: g.id, name: g.name, members: g.members.map((m) => ({ id: m.id, name: memberName(m) })) }));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Best guess: full name, then first name — only when exactly one member matches. */
export function guessMember(playerName: string, members: SplitwiseMember[]): number | undefined {
  const p = norm(playerName);
  const full = members.filter((m) => norm(m.name) === p);
  if (full.length === 1) return full[0].id;
  const first = members.filter((m) => norm(m.name).split(' ')[0] === p.split(' ')[0]);
  return first.length === 1 ? first[0].id : undefined;
}

/**
 * One expense for the whole game: paid share = earned, owed share = spent.
 * Players mapped to the same Splitwise person are merged.
 */
export async function createSplitwiseExpense(opts: {
  groupId: number;
  title: string;
  rows: SplitwiseRow[];
  memberFor: Record<string, number>;
}): Promise<number> {
  const shares = new Map<number, { paid: number; owed: number }>();
  for (const r of opts.rows) {
    const id = opts.memberFor[r.id];
    if (!id) throw new Error(`Pick a Splitwise person for ${r.name}`);
    const s = shares.get(id) ?? { paid: 0, owed: 0 };
    s.paid += cents(r.earned);
    s.owed += cents(r.spent);
    shares.set(id, s);
  }
  const totalC = opts.rows.reduce((s, r) => s + cents(r.spent), 0);
  const body: Record<string, string | number> = {
    cost: (totalC / 100).toFixed(2),
    description: `Poker: ${opts.title}`,
    details: splitwiseText(opts.title, new Date(), opts.rows),
    currency_code: 'EUR',
    group_id: opts.groupId,
    date: new Date().toISOString(),
  };
  [...shares.entries()].forEach(([userId, s], i) => {
    body[`users__${i}__user_id`] = userId;
    body[`users__${i}__paid_share`] = (s.paid / 100).toFixed(2);
    body[`users__${i}__owed_share`] = (s.owed / 100).toFixed(2);
  });
  const data = await api<{ expenses?: { id: number }[]; errors?: Record<string, string[] | string> }>(
    'create_expense',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const errors = Object.values(data.errors ?? {}).flat();
  if (errors.length || !data.expenses?.[0])
    throw new Error(`Splitwise: ${errors.join(', ') || 'expense was not created'}`);
  return data.expenses[0].id;
}
