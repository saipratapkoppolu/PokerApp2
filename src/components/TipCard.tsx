import { SPLITWISE_GROUP_ID, SPLITWISE_PLAYER_IDS } from '../config/splitwise';
import type { Player, TipRecipient } from '../types/app';
import { guessMember, splitwiseApiEnabled, type SplitwiseMember } from '../utils/splitwise';

type Props = {
  players: Player[];
  /** Splitwise group members; null = this device isn't connected, so the game's players are listed. */
  members: SplitwiseMember[] | null;
  amount: string;
  to?: TipRecipient;
  onAmount: (amount: string) => void;
  onTo: (to: TipRecipient | null) => void;
};

const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const configIds: Record<string, number> = Object.fromEntries(
  Object.entries(SPLITWISE_PLAYER_IDS).map(([name, id]) => [nameKey(name), id]),
);

const valueOf = (to?: TipRecipient) => (to?.splitwiseId ? `sw:${to.splitwiseId}` : to?.playerId ? `player:${to.playerId}` : '');

/** Finish dialog: optional tip out of the prize pool, to anyone in the Splitwise group. */
export default function TipCard({ players, members, amount, to, onAmount, onTo }: Props) {
  // The game's player who is this Splitwise member (config, then name match), so the tip shows on their result.
  const playerFor = (m: SplitwiseMember) =>
    players.find((p) => configIds[nameKey(p.name)] === m.id) ?? players.find((p) => guessMember(p.name, members ?? []) === m.id);

  // No Splitwise group configured: nobody can be picked, so no tip.
  const options: { value: string; label: string; to: TipRecipient }[] = !SPLITWISE_GROUP_ID
    ? []
    : members
    ? members.map((m) => {
        const player = playerFor(m);
        return { value: `sw:${m.id}`, label: m.name, to: { name: m.name, splitwiseId: m.id, ...(player ? { playerId: player.id } : {}) } };
      })
    : players.map((p) => ({ value: `player:${p.id}`, label: p.name, to: { name: p.name, playerId: p.id } }));
  // Picked on another device from a list this one can't load: keep showing it.
  const current = valueOf(to);
  if (SPLITWISE_GROUP_ID && to && current && !options.some((o) => o.value === current)) options.unshift({ value: current, label: to.name, to });

  return (
    <div className="payout-card tip-card">
      <div className="payout-place">
        <span>💁</span>
        <span>Tip</span>
        <span className="payout-pct tiny">from the pool</span>
      </div>
      <select
        aria-label="Tip goes to"
        disabled={!SPLITWISE_GROUP_ID}
        value={current}
        onChange={(e) => {
          const value = e.target.value;
          onTo(options.find((o) => o.value === value)?.to ?? null);
        }}
      >
        <option value="">{members || !SPLITWISE_GROUP_ID ? 'Tip to…' : 'Tip to player…'}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <div className="money-input">
        <span>€</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="1"
          placeholder="0"
          disabled={!SPLITWISE_GROUP_ID}
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
        />
      </div>
      {!SPLITWISE_GROUP_ID && <div className="tiny muted tip-hint">No Splitwise group set, so nobody can get a tip.</div>}
      {SPLITWISE_GROUP_ID > 0 && !members && splitwiseApiEnabled && <div className="tiny muted tip-hint">Connect Splitwise on this phone to tip anyone in the group.</div>}
    </div>
  );
}
