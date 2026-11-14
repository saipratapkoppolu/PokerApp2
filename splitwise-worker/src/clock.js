/**
 * Blinds-up alerts, sent from here at the moment each level ends, so they always follow the game's current clock
 * (phones don't schedule their own: one that slept through a pause or a skipped level would alert at the old time).
 *
 * One RoomClock (a Durable Object, by room id) per game. Whenever the admin changes the clock (start, pause, resume,
 * level, minute added, levels edited), the app calls /notify { event: 'clock' } and the room plans its next alert:
 * a minute before the level ends ("One minute left in this level.") and as it ends ("Blinds up: 200 / 400").
 * Each alarm reads the room again and only sends when the clock still says it's that moment.
 *
 * Pausing and resuming tell the other players too ("Clock paused." / "Clock resumed."), as a notification, and so
 * does a knockout ("Dan was knocked out by Ann").
 *
 * The iPhones' Live Activities (lock screen, Dynamic Island) follow too: the same moments update them, by push, to the
 * clock as it is (the next level as one ends, the new time after a change), as the app does while it's open.
 */
import { DurableObject } from 'cloudflare:workers';
import { read, send, sendLiveActivity, write } from './push.js';

const SITE = 'https://poker-tracker-2ab9c.web.app';
/** How far off an alarm may be from the moment it was set for and still send (a late alarm says nothing). */
const TOLERANCE_MS = 5_000;

export class RoomClock extends DurableObject {
  /** POST { roomId, by }: the game changed (by that account), plan the next alert. */
  async fetch(request) {
    const { roomId, by } = await request.json();
    await this.ctx.storage.put('roomId', roomId);
    const room = await read(this.env, `rooms/${roomId}`);
    await this.announcePauseOrResume(roomId, room, by);
    await this.announceKnockout(roomId, room, by);
    await this.plan(roomId, room);
    await updateActivities(this.env, roomId, room, Date.now());
    return new Response('ok');
  }

  async alarm() {
    const roomId = await this.ctx.storage.get('roomId');
    const due = await this.ctx.storage.get('due');
    if (!roomId) return;
    const room = await read(this.env, `rooms/${roomId}`);
    const now = Date.now();
    if (due && isLive(room) && Math.abs(now - due.at) <= TOLERANCE_MS) {
      const levels = normalizeLevels(room.settings?.levels);
      // A moment ahead, so a level ending right now already counts as the next one.
      const view = computeClock(room.clock, levels, now + 1_000);
      const stillDue =
        due.kind === 'level'
          ? view.levelIndex === due.levelIndex && view.elapsedMs <= TOLERANCE_MS + 1_000
          : view.levelIndex === due.levelIndex && Math.abs(view.remainingMs - 60_000) <= TOLERANCE_MS + 1_000;
      if (stillDue) await this.alert(room, roomId, due.kind, view.level);
    }
    // A level ended: the Live Activities show the next one.
    if (due?.kind === 'level') await updateActivities(this.env, roomId, room, now + 1_000);
    await this.plan(roomId, room);
  }

  /** "Clock paused." / "Clock resumed." to everyone but whoever did it, when the clock stopped or started since
   *  the last change (not when the game starts: that has its own message). */
  async announcePauseOrResume(roomId, room, by) {
    const running = !!(room && room.phase === 'game' && room.clock?.running);
    const was = await this.ctx.storage.get('running');
    await this.ctx.storage.put('running', running);
    if (was === undefined || was === running || room?.phase !== 'game') return;
    const to = Object.values(room.users || {}).flatMap((u) => (u?.uid && u.uid !== by ? [u.uid] : []));
    await send(this.env, {
      to,
      title: room.title || 'Poker',
      body: running ? 'Clock resumed.' : 'Clock paused.',
      link: `${SITE}/#room=${roomId}`,
      thread: roomId,
      data: { kind: 'clock', roomId },
      // Old news a minute later.
      expiresInSeconds: 60,
    });
  }

  /** A knockout just recorded: who was knocked out by whom, to everyone but whoever recorded it. Once per knockout,
   *  and only a fresh one (an undo, or a change long after, says nothing). */
  async announceKnockout(roomId, room, by) {
    const events = Array.isArray(room?.events) ? room.events : Object.values(room?.events || {});
    const knockout = events.find((e) => e?.type === 'knockout_recorded');
    if (!knockout || room.phase !== 'game' || (await this.ctx.storage.get('knockout')) === knockout.id) return;
    await this.ctx.storage.put('knockout', knockout.id);
    if (Date.now() - (knockout.createdAt || 0) > 60_000) return;
    const meta = knockout.meta || {};
    const sentence = (meta.details || `${meta.eliminatedNames} by ${meta.winnerNames}`)
      .split('; ')
      .map((part) => part.replace(' by ', ' was knocked out by '))
      .join(' · ');
    const to = Object.values(room.users || {}).flatMap((u) => (u?.uid && u.uid !== by ? [u.uid] : []));
    await send(this.env, {
      to,
      title: '💀 Knockout',
      body: `${sentence}${meta.bountyText ? ` · ${meta.bountyText}` : ''}`,
      link: `${SITE}/#room=${roomId}`,
      thread: roomId,
      data: { kind: 'clock', roomId },
      expiresInSeconds: 60,
    });
  }

  /** The next alert for this clock, or none (paused, finished, not playing). */
  async plan(roomId, room) {
    await this.ctx.storage.delete('due');
    await this.ctx.storage.deleteAlarm();
    if (!isLive(room)) return;
    const levels = normalizeLevels(room.settings?.levels);
    const now = Date.now();
    const view = computeClock(room.clock, levels, now);
    if (!view.running || !view.nextLevel) return;
    const levelEnd = now + view.remainingMs;
    const minuteBefore = levelEnd - 60_000;
    // The one-minute warning, unless that moment has (nearly) passed or the level is a minute or less.
    const due =
      minuteBefore > now + 1_000 && view.durationMs > 60_000
        ? { kind: 'minute', at: minuteBefore, levelIndex: view.levelIndex }
        : { kind: 'level', at: levelEnd, levelIndex: view.levelIndex + 1 };
    await this.ctx.storage.put('due', due);
    await this.ctx.storage.setAlarm(due.at);
  }

  async alert(room, roomId, kind, level) {
    const to = Object.values(room.users || {}).flatMap((u) => (u?.uid ? [u.uid] : []));
    const isLevel = kind === 'level';
    await send(this.env, {
      to,
      title: isLevel ? (level.isBreak ? 'Break' : `Blinds up: ${blindsLabel(level)}`) : 'One minute left in this level.',
      body: room.title || 'Poker',
      link: `${SITE}/#room=${roomId}`,
      thread: roomId,
      // Spoken on iPhone: "Blinds up!" / "Break time!" (made by the app, NotificationVoices) or the app's
      // "One minute left in this level."
      sound: isLevel ? (level.isBreak ? 'break-time.caf' : 'blinds-up.caf') : 'one-minute.caf',
      urgent: true,
      data: { kind: 'level', roomId },
      // Only worth anything right now.
      expiresInSeconds: 30,
    });
  }
}

const isLive = (room) => room && room.phase === 'game' && room.clock?.running;

/** Seconds from 1970 to 2001: ActivityKit reads dates in an update as seconds since 2001 (Swift's default). */
const SINCE_2001 = 978_307_200;

/** Moves the game's Live Activities to the clock as it is at `at` (ms), or ends them once the game is over. */
async function updateActivities(env, roomId, room, at) {
  const timestamp = Math.floor(Date.now() / 1000);
  if (!room || room.phase === 'end') {
    await sendLiveActivity(env, roomId, { timestamp, event: 'end', 'dismissal-date': timestamp });
    await write(env, `liveActivityTokens/${roomId}`, null);
    return;
  }
  if (room.phase !== 'game') return;
  const view = computeClock(room.clock, normalizeLevels(room.settings?.levels), at);
  const players = Array.isArray(room.players) ? room.players : Object.values(room.players || {});
  const levelEnd = at + view.remainingMs;
  // ClockActivityAttributes.ContentState in the app (the same labels it shows).
  const state = {
    levelLabel: view.level.isBreak ? 'Break' : `Level ${view.levelNumber}`,
    blinds: view.level.isBreak ? 'Break' : blindsLabel(view.level),
    ...(view.nextLevel ? { nextBlinds: view.nextLevel.isBreak ? 'Break' : blindsLabel(view.nextLevel) } : {}),
    ...(view.running ? { levelEndsAt: levelEnd / 1000 - SINCE_2001 } : {}),
    pausedRemaining: formatClock(view.remainingMs),
    playersLeft: players.filter((p) => p && p.active !== false).length,
  };
  await sendLiveActivity(env, roomId, {
    timestamp,
    event: 'update',
    'content-state': state,
    ...(view.running ? { 'stale-date': Math.floor(levelEnd / 1000) + 3600 } : {}),
  });
}

// The same clock maths as the apps (src/utils/blinds.ts on the web, Blinds.computeClock on iOS).

const HOUSE_BIG_BLINDS = [200, 400, 800, 1000, 2000, 4000, 8000, 10000, 20000, 40000, 80000, 100000, 200000];
const DEFAULT_LEVELS = HOUSE_BIG_BLINDS.map((bb) => ({ sb: bb / 2, bb, ante: 0, minutes: 15, isBreak: false }));

function normalizeLevels(levels) {
  const list = Array.isArray(levels) ? levels : levels && typeof levels === 'object' ? Object.values(levels) : [];
  const clean = list.filter(Boolean).map((level) => ({
    sb: Number(level.sb) || 0,
    bb: Number(level.bb) || 0,
    ante: Number(level.ante) || 0,
    minutes: Math.max(1, Number(level.minutes) || 1),
    isBreak: !!level.isBreak,
  }));
  return clean.length > 0 ? clean : DEFAULT_LEVELS;
}

function computeClock(clock, levels, serverNow) {
  const state = clock || { running: false, levelIndex: 0, levelElapsedMs: 0, startedAt: null };
  const lastIndex = levels.length - 1;
  let index = Math.min(Math.max(0, state.levelIndex || 0), lastIndex);
  let elapsed = (state.levelElapsedMs || 0) + (state.running && state.startedAt ? Math.max(0, serverNow - state.startedAt) : 0);
  while (index < lastIndex && elapsed >= levels[index].minutes * 60_000) {
    elapsed -= levels[index].minutes * 60_000;
    index += 1;
  }
  const durationMs = levels[index].minutes * 60_000;
  const remainingMs = Math.max(0, durationMs - elapsed);
  const finished = index === lastIndex && remainingMs === 0;
  return {
    levelIndex: index,
    elapsedMs: Math.min(elapsed, durationMs),
    remainingMs,
    durationMs,
    running: !!state.running && !finished,
    level: levels[index],
    nextLevel: levels[index + 1] ?? null,
    levelNumber: levels.slice(0, index + 1).filter((level) => !level.isBreak).length,
  };
}

function formatClock(ms) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

function chips(n) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000 && n % 100 === 0) return `${n / 1000}K`;
  return n.toLocaleString('en-US');
}

function blindsLabel(level) {
  return `${chips(level.sb)} / ${chips(level.bb)}${level.ante > 0 ? ` · ante ${chips(level.ante)}` : ''}`;
}
