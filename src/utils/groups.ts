import { ref, update } from 'firebase/database';
import { db } from '../firebase';
import type { GroupMember, PlayerGroup, UserIdentity } from '../types/app';
import { makeId } from './room';
import { normalizeName, sameName } from './format';

// Data: groups/{groupId} (read by members, written by its admins) + userGroups/{uid}/{groupId} = true,
// the list of groups each account is in. Every change writes both in one multi-path update.

export const MAX_GROUP_NAME = 40;

/** Names are capped like group names (the database rules reject longer ones). */
export const memberName = (name: string) => normalizeName(name).slice(0, MAX_GROUP_NAME) || 'Player';

export const isGroupAdmin = (group: PlayerGroup, uid: string) => group.admins?.[uid] === true;

export const groupMembers = (group: PlayerGroup) =>
  Object.entries(group.members ?? {})
    .map(([key, m]) => ({ key, ...m }))
    .sort((a, b) => a.name.localeCompare(b.name));

export const hasMemberNamed = (group: PlayerGroup, name: string) =>
  Object.values(group.members ?? {}).some((m) => sameName(m.name, name));

export async function createGroup(name: string, me: UserIdentity): Promise<string> {
  const id = makeId();
  const now = Date.now();
  const group: Omit<PlayerGroup, 'id'> = {
    name: normalizeName(name).slice(0, MAX_GROUP_NAME),
    createdAt: now,
    createdBy: { uid: me.uid, displayName: me.displayName },
    members: { [me.uid]: { name: memberName(me.displayName), uid: me.uid, addedAt: now } },
    admins: { [me.uid]: true },
  };
  await update(ref(db), { [`groups/${id}`]: group, [`userGroups/${me.uid}/${id}`]: true });
  return id;
}

export async function renameGroup(groupId: string, name: string) {
  await update(ref(db, `groups/${groupId}`), { name: normalizeName(name).slice(0, MAX_GROUP_NAME) });
}

/** Add app accounts (by uid) and/or typed names. */
export async function addGroupMembers(groupId: string, accounts: { uid: string; name: string }[], names: string[]) {
  const now = Date.now();
  const changes: Record<string, GroupMember | true> = {};
  accounts.forEach((a) => {
    changes[`groups/${groupId}/members/${a.uid}`] = { name: memberName(a.name), uid: a.uid, addedAt: now };
    changes[`userGroups/${a.uid}/${groupId}`] = true;
  });
  names.forEach((n) => {
    changes[`groups/${groupId}/members/n_${makeId()}`] = { name: memberName(n), addedAt: now };
  });
  if (Object.keys(changes).length) await update(ref(db), changes);
}

/** Renames the member stored under `key` in each of these groups, in one write (admins: names without an
 *  account; anyone: their own name, to keep their display name the same in every group). */
export async function renameGroupMember(key: string, name: string, groupIds: string[]) {
  const changes: Record<string, string> = {};
  groupIds.forEach((id) => {
    changes[`groups/${id}/members/${key}/name`] = memberName(name);
  });
  if (Object.keys(changes).length) await update(ref(db), changes);
}

/** Remove a member (also used to leave: key = your own uid). Admin rights go with them. */
export async function removeGroupMember(groupId: string, key: string, member: GroupMember) {
  const changes: Record<string, null> = { [`groups/${groupId}/members/${key}`]: null };
  if (member.uid) {
    changes[`groups/${groupId}/admins/${member.uid}`] = null;
    changes[`userGroups/${member.uid}/${groupId}`] = null;
  }
  await update(ref(db), changes);
}

export async function setGroupAdmin(groupId: string, uid: string, admin: boolean) {
  await update(ref(db, `groups/${groupId}/admins`), { [uid]: admin ? true : null });
}

/** Deletes the group and takes it off every member's list. */
export async function deleteGroup(group: PlayerGroup) {
  const changes: Record<string, null> = { [`groups/${group.id}`]: null };
  Object.values(group.members ?? {}).forEach((m) => {
    if (m.uid) changes[`userGroups/${m.uid}/${group.id}`] = null;
  });
  await update(ref(db), changes);
}
