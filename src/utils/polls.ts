import { ref, set, update } from 'firebase/database';
import { db } from '../firebase';
import type { GamePoll, PlayerGroup, PollAnswer, PollVote, RoomState, UserIdentity } from '../types/app';
import { normalizeName, sameName } from './format';
import { makeId } from './room';
import { notifyEvent } from './push';

/** "Who's in?" polls, the same shape as the iOS app (groupPolls/{groupId}/{pollId}). */

export const POLL_ANSWERS: { answer: PollAnswer; label: string }[] = [
  { answer: 'in', label: 'In' },
  { answer: 'buyin', label: 'Buy-in' },
  { answer: 'out', label: 'Out' },
];

/** A poll stays on the list until its game is started, or until 12 hours after its time. */
const SHOWN_AFTER_START = 12 * 3600_000;

export function isOpenPoll(poll: GamePoll, now = Date.now()) {
  return !poll.roomId && poll.startsAt > now - SHOWN_AFTER_START;
}

/** Votes with this answer, as [member key, vote], in the order they answered. */
export function votesAnswering(poll: GamePoll, answer: PollAnswer): [string, PollVote][] {
  return Object.entries(poll.votes ?? {})
    .filter(([, vote]) => vote.answer === answer)
    .sort(([, a], [, b]) => a.at - b.at);
}

/** The new game's players: everyone in, then everyone buying in, tidied and without repeats. */
export function startingPlayers(poll: GamePoll): string[] {
  const names: string[] = [];
  for (const [, vote] of [...votesAnswering(poll, 'in'), ...votesAnswering(poll, 'buyin')]) {
    const name = normalizeName(vote.name);
    if (name && !names.some((n) => sameName(n, name))) names.push(name);
  }
  return names;
}

/** Whoever posted the poll and the group's admins: they can delete it. */
export function canManagePoll(poll: GamePoll, groups: PlayerGroup[], uid: string) {
  return poll.createdBy?.uid === uid || groups.find((g) => g.id === poll.groupId)?.admins?.[uid] === true;
}

/** Posts the poll and, once saved, notifies the group. */
export async function createPoll(groupId: string, title: string, startsAt: number, me: UserIdentity) {
  const id = makeId();
  await set(ref(db, `groupPolls/${groupId}/${id}`), {
    title: normalizeName(title).slice(0, 40),
    startsAt,
    createdAt: Date.now(),
    createdBy: { uid: me.uid, displayName: me.displayName },
  });
  void notifyEvent({ event: 'poll', groupId, pollId: id });
}

/** Your own answer (`key`: your uid; the rules refuse answers for anyone else). */
export function answerPoll(poll: GamePoll, key: string, name: string, answer: PollAnswer) {
  return set(ref(db, `groupPolls/${poll.groupId}/${poll.id}/votes/${key}`), { answer, name, at: Date.now() });
}

export function deletePoll(poll: GamePoll) {
  return set(ref(db, `groupPolls/${poll.groupId}/${poll.id}`), null);
}

/** The new game and the poll's link to it, in one write; then everyone in or buying in is told. */
export async function startGameFromPoll(poll: GamePoll, room: RoomState) {
  await update(ref(db), {
    [`rooms/${room.roomId}`]: room,
    [`groupPolls/${poll.groupId}/${poll.id}/roomId`]: room.roomId,
  });
  void notifyEvent({ event: 'game', groupId: poll.groupId, pollId: poll.id, roomId: room.roomId });
}

const SITE = 'https://poker-tracker-2ab9c.web.app';

/** The poll's link, for sharing: opens the iOS app when it's installed, the website otherwise. */
export function pollLink(poll: GamePoll) {
  return `${SITE}/poll/${poll.groupId}/${poll.id}`;
}

/** The poll a link points to (/poll/{groupId}/{pollId}), if it's one. */
export function pollFromPath(path: string): { groupId: string; pollId: string } | null {
  const match = path.match(/^\/poll\/([^/]+)\/([^/]+)\/?$/);
  return match ? { groupId: match[1], pollId: match[2] } : null;
}

/** Shares the poll to WhatsApp: its title, time and link. */
export function shareToWhatsApp(poll: GamePoll, when: string) {
  const text = `${poll.title}: who’s in? ${when}\n${pollLink(poll)}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}
