import { useEffect, useState } from 'react';
import { CalendarClock, Check, Play, Trash2 } from 'lucide-react';
import type { GamePoll, PlayerGroup, PollAnswer, UserIdentity } from '../types/app';
import { POLL_ANSWERS, answerPoll, canManagePoll, deletePoll, isOpenPoll, shareToWhatsApp, votesAnswering } from '../utils/polls';

type Props = {
  polls: GamePoll[];
  groups: PlayerGroup[];
  identity: UserIdentity;
  onStartGame: (poll: GamePoll) => void;
  onNotice: (message: string) => void;
  /** A poll opened from a shared link: its votes open. */
  openPollId?: string;
};

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** "Who's in?" polls from your groups: answer In, Buy-in or Out for yourself, or start the game (you become its admin). Whoever posted it and the group's admins can delete it. */
export default function PollsCard({ polls, groups, identity, onStartGame, onNotice, openPollId }: Props) {
  const open = polls.filter((poll) => isOpenPoll(poll));
  const [expanded, setExpanded] = useState('');
  useEffect(() => {
    if (openPollId) setExpanded(openPollId);
  }, [openPollId]);
  if (open.length === 0) return null;

  async function save(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      console.error('poll change failed', error);
      onNotice('Could not save — check your connection and try again.');
    }
  }

  return (
    <section className="card">
      <div className="section-head">
        <div className="section-title">Who’s in?</div>
        <span className="pill">{open.length}</span>
      </div>
      <div className="stack-list">
        {open.map((poll) => {
          const group = groups.find((g) => g.id === poll.groupId);
          const admin = canManagePoll(poll, groups, identity.uid);
          const mine = poll.votes?.[identity.uid]?.answer;
          const myName = group?.members?.[identity.uid]?.name ?? identity.displayName;
          const showsVotes = expanded === poll.id;
          const total = Object.keys(poll.votes ?? {}).length;
          const answer = (value: PollAnswer) => void save(() => answerPoll(poll, identity.uid, myName, value));
          return (
            <div key={poll.id} className="poll">
              <div>
                <div className="poll-title">{poll.title}</div>
                <div className="tiny muted">
                  <CalendarClock size={12} /> {when(poll.startsAt)} · {group?.name ?? ''}
                </div>
              </div>
              <div className="poll-options">
                {POLL_ANSWERS.map(({ answer: value, label }) => {
                  const count = votesAnswering(poll, value).length;
                  const share = total ? Math.round((count / total) * 100) : 0;
                  return (
                    <button
                      key={value}
                      className={`poll-option${mine === value ? ' chosen' : ''}`}
                      style={{ '--share': `${share}%` } as React.CSSProperties}
                      aria-pressed={mine === value}
                      onClick={() => answer(value)}
                    >
                      <span className="poll-option-label">
                        {mine === value && <Check size={14} />} {label}
                      </span>
                      <span className="poll-count">{count}</span>
                    </button>
                  );
                })}
              </div>
              <div className="input-row poll-links">
                <button className="link-btn poll-toggle" onClick={() => setExpanded(poll.id)}>
                  View votes
                </button>
                <button className="link-btn" onClick={() => shareToWhatsApp(poll, when(poll.startsAt))}>
                  Share to WhatsApp
                </button>
              </div>
              {showsVotes && (
                <div className="modal-backdrop bottom" onClick={() => setExpanded('')}>
                  <div className="modal-card" role="dialog" aria-label={`Votes for ${poll.title}`} onClick={(e) => e.stopPropagation()}>
                    <div className="modal-body">
                      <div className="modal-title">{poll.title}</div>
                      <div className="tiny muted">{when(poll.startsAt)}</div>
                      {POLL_ANSWERS.map(({ answer: value, label }) => {
                        const votes = votesAnswering(poll, value);
                        return (
                          <div key={value} className="poll-votes">
                            <div className="poll-votes-label">
                              {label} · {votes.length}
                            </div>
                            <div className="tiny muted">{votes.length ? votes.map(([, vote]) => vote.name).join(', ') : 'No one yet'}</div>
                          </div>
                        );
                      })}
                      <div className="input-row">
                        <button
                          className="btn btn-green"
                          onClick={() => {
                            setExpanded('');
                            onStartGame(poll);
                          }}
                        >
                          <Play size={14} /> Start game
                        </button>
                        {admin && (
                          <button
                            className="btn btn-ghost"
                            onClick={() => {
                              if (!window.confirm(`Delete “${poll.title}”?`)) return;
                              setExpanded('');
                              void save(() => deletePoll(poll));
                            }}
                          >
                            <Trash2 size={14} /> Delete
                          </button>
                        )}
                      </div>
                      <button className="btn btn-ghost btn-block" onClick={() => setExpanded('')}>
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
