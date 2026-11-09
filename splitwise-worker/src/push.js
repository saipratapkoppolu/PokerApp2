/**
 * Push notifications for the poker apps (iOS and web), through Firebase Cloud Messaging (HTTP v1).
 *
 *   POST /notify   { event, groupId, pollId?, roomId?, uids? }   (Authorization: Bearer <Firebase ID token>)
 *     poll   — a new "Who's in?" poll: every group member with an account, except the poster
 *     game   — a game started from a poll: everyone who answered In or Buy-in, except who started it
 *     added  — accounts just added to a group: those accounts
 *     test   — a test from Settings: only to the caller
 *   cron     — an hour before a poll starts: members who haven't answered yet (once per poll)
 *
 * The worker reads the database with a service account (secret FIREBASE_SERVICE_ACCOUNT), which skips the
 * database rules, so it checks permissions itself and builds every message and recipient list from the
 * database: nothing in the request is shown to anyone. Devices register at pushTokens/{uid}/{key}.
 */

const PROJECT = 'poker-tracker-2ab9c';
const DB = 'https://poker-tracker-2ab9c-default-rtdb.europe-west1.firebasedatabase.app';
const SITE = 'https://poker-tracker-2ab9c.web.app';
const REMINDER_FROM = 45 * 60_000;
const REMINDER_TO = 75 * 60_000;

// ---------------------------------------------------------------- requests

export async function notify(request, env, cors) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
  const uid = await verifyIdToken((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
  if (!uid) return json({ error: 'Sign in first' }, 401, cors);
  const body = await request.json().catch(() => ({}));
  // A test from Settings, only to yourself: your newest open poll, the way a real one arrives (opens it, and on
  // iPhone has In / Buy-in / Out); a plain note when none of your groups has one.
  if (body.event === 'test') {
    const poll = await newestOpenPoll(env, uid);
    const message = poll
      ? {
          title: poll.title,
          body: `Test: this is how ${poll.groupName} polls reach you.`,
          link: `${SITE}/poll/${poll.groupId}/${poll.pollId}`,
          thread: poll.groupId,
          poll: { groupId: poll.groupId, pollId: poll.pollId },
        }
      : { title: 'Notifications are on', body: 'Polls, games and reminders will reach you here.', link: SITE };
    const sent = await send(env, { to: [uid], ...message });
    return json({ sent }, 200, cors);
  }
  const groupId = safeKey(body.groupId);
  if (!groupId) return json({ error: 'Missing group' }, 400, cors);

  const group = await read(env, `groups/${groupId}`);
  if (!group?.members?.[uid]) return json({ error: 'Not in this group' }, 403, cors);
  const accounts = Object.values(group.members).flatMap((m) => (m.uid ? [m.uid] : []));
  const caller = group.members[uid].name || 'Someone';

  let message;
  if (body.event === 'poll') {
    const pollId = safeKey(body.pollId);
    const poll = pollId && (await read(env, `groupPolls/${groupId}/${pollId}`));
    if (!poll || poll.createdBy?.uid !== uid) return json({ error: 'Not your poll' }, 403, cors);
    message = {
      to: accounts.filter((a) => a !== uid),
      title: poll.title,
      body: `${caller} asked ${group.name} who’s in.`,
      link: `${SITE}/poll/${groupId}/${pollId}`,
      thread: groupId,
      poll: { groupId, pollId },
    };
  } else if (body.event === 'game') {
    const pollId = safeKey(body.pollId);
    const roomId = safeKey(body.roomId);
    const [poll, room] = await Promise.all([
      pollId ? read(env, `groupPolls/${groupId}/${pollId}`) : null,
      roomId ? read(env, `rooms/${roomId}`) : null,
    ]);
    if (!poll || !room || poll.roomId !== roomId || room.createdBy?.uid !== uid) {
      return json({ error: 'Not your game' }, 403, cors);
    }
    const playing = Object.entries(poll.votes || {})
      .filter(([key, vote]) => key !== uid && (vote.answer === 'in' || vote.answer === 'buyin'))
      .map(([key]) => key)
      .filter((key) => accounts.includes(key));
    message = {
      to: playing,
      title: `${room.title} has started`,
      body: `${caller} started the game.`,
      link: `${SITE}/#room=${roomId}`,
      thread: groupId,
      urgent: true,
    };
  } else if (body.event === 'added') {
    if (group.admins?.[uid] !== true) return json({ error: 'Admins only' }, 403, cors);
    const added = (Array.isArray(body.uids) ? body.uids : []).map(safeKey).filter((a) => a && a !== uid && accounts.includes(a));
    message = { to: added, title: group.name, body: `${caller} added you to the group.`, link: SITE, thread: groupId };
  } else {
    return json({ error: 'Unknown event' }, 400, cors);
  }

  const sent = await send(env, message);
  return json({ sent }, 200, cors);
}

/** The open poll (no game yet, not long past) in your groups that was posted last, or null. */
async function newestOpenPoll(env, uid) {
  const groupIds = Object.keys((await read(env, `userGroups/${uid}`)) || {}).filter(safeKey);
  let newest = null;
  for (const groupId of groupIds) {
    const [group, polls] = await Promise.all([read(env, `groups/${groupId}`), read(env, `groupPolls/${groupId}`)]);
    for (const [pollId, poll] of Object.entries(polls || {})) {
      const open = !poll.roomId && (poll.startsAt || 0) > Date.now() - 12 * 3600_000;
      if (open && (!newest || (poll.createdAt || 0) > newest.createdAt)) {
        newest = { groupId, pollId, title: poll.title, createdAt: poll.createdAt || 0, groupName: group?.name || 'your group' };
      }
    }
  }
  return newest;
}

/** Cron: an hour before each open poll, members with an account who haven't answered (once per poll). */
export async function remind(env) {
  const [allPolls, groups] = await Promise.all([read(env, 'groupPolls'), read(env, 'groups')]);
  const now = Date.now();
  for (const [groupId, polls] of Object.entries(allPolls || {})) {
    const group = groups?.[groupId];
    if (!group) continue;
    for (const [pollId, poll] of Object.entries(polls || {})) {
      const lead = (poll.startsAt || 0) - now;
      if (poll.roomId || poll.reminderSent || lead < REMINDER_FROM || lead > REMINDER_TO) continue;
      const waiting = Object.entries(group.members || {})
        .filter(([key, m]) => m.uid && !poll.votes?.[key])
        .map(([, m]) => m.uid);
      await write(env, `groupPolls/${groupId}/${pollId}/reminderSent`, true);
      await send(env, {
        to: waiting,
        title: `${poll.title} starts in an hour`,
        body: `Let ${group.name} know if you’re in.`,
        link: `${SITE}/poll/${groupId}/${pollId}`,
        thread: groupId,
        poll: { groupId, pollId },
        urgent: true,
      });
    }
  }
}

// ---------------------------------------------------------------- sending

/**
 * One FCM message per device of each recipient; devices FCM no longer knows are forgotten. On iOS: grouped by
 * `thread` (the group), `poll` adds the In / Buy-in / Out actions (category POLL), and `urgent` (a game starting,
 * a reminder) is time-sensitive, so it comes through Focus.
 */
async function send(env, { to, title, body, link, thread, poll, urgent }) {
  if (!to.length) return 0;
  const tokens = (await read(env, 'pushTokens')) || {};
  const access = await accessToken(env);
  let sent = 0;
  for (const uid of new Set(to)) {
    for (const [key, device] of Object.entries(tokens[uid] || {})) {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: device.token,
            notification: { title, body },
            data: { link, ...(poll ? { groupId: poll.groupId, pollId: poll.pollId } : {}) },
            apns: {
              payload: {
                aps: {
                  sound: 'default',
                  ...(thread ? { 'thread-id': thread } : {}),
                  ...(poll ? { category: 'POLL' } : {}),
                  'interruption-level': urgent ? 'time-sensitive' : 'active',
                },
              },
            },
            webpush: { fcm_options: { link }, notification: { icon: '/icon.svg' } },
          },
        }),
      });
      if (res.ok) {
        sent += 1;
      } else {
        // Shown by `wrangler tail`: why a device didn't get it (e.g. a missing APNs key in Firebase).
        const reason = await res.text();
        console.log(`push to ${device.platform} failed: ${res.status} ${reason.slice(0, 300)}`);
        // Only devices FCM no longer knows are forgotten (not, say, a missing APNs key).
        if (res.status === 404 || reason.includes('UNREGISTERED')) await write(env, `pushTokens/${uid}/${key}`, null);
      }
    }
  }
  return sent;
}

// ---------------------------------------------------------------- database (service account)

async function read(env, path) {
  const res = await fetch(`${DB}/${path}.json`, { headers: { Authorization: `Bearer ${await accessToken(env)}` } });
  if (!res.ok) throw new Error(`read ${path}: ${res.status}`);
  return res.json();
}

async function write(env, path, value) {
  const res = await fetch(`${DB}/${path}.json`, {
    method: value === null ? 'DELETE' : 'PUT',
    headers: { Authorization: `Bearer ${await accessToken(env)}`, 'Content-Type': 'application/json' },
    body: value === null ? undefined : JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`write ${path}: ${res.status}`);
}

/** Keys from requests become database paths: only plain keys. */
const safeKey = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : '');

// ---------------------------------------------------------------- Google auth

let cachedAccess = { token: '', expires: 0 };

/** An OAuth token for FCM and the database, from the service account (cached for most of its hour). */
async function accessToken(env) {
  if (cachedAccess.token && Date.now() < cachedAccess.expires) return cachedAccess.token;
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: account.client_email,
    scope: [
      'https://www.googleapis.com/auth/firebase.messaging',
      'https://www.googleapis.com/auth/firebase.database',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const jwt = await signJwt(claims, account.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`Google token: ${res.status}`);
  cachedAccess = { token: data.access_token, expires: Date.now() + (data.expires_in - 300) * 1000 };
  return cachedAccess.token;
}

async function signJwt(claims, pem) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const part = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${part({ alg: 'RS256', typ: 'JWT' })}.${part(claims)}`;
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input)));
  return `${input}.${b64url(signature)}`;
}

let cachedKeys = { keys: [], expires: 0 };

/** The signed-in Firebase user behind an ID token (checked against Google's public keys), or ''. */
async function verifyIdToken(token) {
  try {
    const [h, p, s] = token.split('.');
    const header = JSON.parse(new TextDecoder().decode(unb64url(h)));
    const payload = JSON.parse(new TextDecoder().decode(unb64url(p)));
    const now = Date.now() / 1000;
    if (payload.aud !== PROJECT || payload.iss !== `https://securetoken.google.com/${PROJECT}`) return '';
    if (!payload.sub || payload.exp < now || payload.iat > now + 300) return '';
    if (Date.now() > cachedKeys.expires) {
      const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
      cachedKeys = { keys: (await res.json()).keys || [], expires: Date.now() + 3600_000 };
    }
    const jwk = cachedKeys.keys.find((k) => k.kid === header.kid);
    if (!jwk) return '';
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64url(s), new TextEncoder().encode(`${h}.${p}`));
    return ok ? payload.sub : '';
  } catch {
    return '';
  }
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
