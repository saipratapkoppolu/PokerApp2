import { ref, set, update } from 'firebase/database';
import { db } from '../firebase';
import type { GamePoll, PlayerGroup, PollAnswer, PollVote, RoomState, UserIdentity } from '../types/app';
import { normalizeName, sameName } from './format';
import { makeId } from './room';

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

export function createPoll(groupId: string, title: string, startsAt: number, me: UserIdentity) {
  const id = makeId();
  return set(ref(db, `groupPolls/${groupId}/${id}`), {
    title: normalizeName(title).slice(0, 40),
    startsAt,
    createdAt: Date.now(),
    createdBy: { uid: me.uid, displayName: me.displayName },
  });
}

/** Your own answer (`key`: your uid; the rules refuse answers for anyone else). */
export function answerPoll(poll: GamePoll, key: string, name: string, answer: PollAnswer) {
  return set(ref(db, `groupPolls/${poll.groupId}/${poll.id}/votes/${key}`), { answer, name, at: Date.now() });
}

export function deletePoll(poll: GamePoll) {
  return set(ref(db, `groupPolls/${poll.groupId}/${poll.id}`), null);
}

/** The new game and the poll's link to it, in one write. */
export function startGameFromPoll(poll: GamePoll, room: RoomState) {
  return update(ref(db), {
    [`rooms/${room.roomId}`]: room,
    [`groupPolls/${poll.groupId}/${poll.id}/roomId`]: room.roomId,
  });
}
