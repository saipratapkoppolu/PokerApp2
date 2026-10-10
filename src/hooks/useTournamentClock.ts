import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '../firebase';
import type { BlindLevel, ClockState, LevelSound } from '../types/app';
import { blindsLabel, computeClock, type ClockView } from '../utils/blinds';
import {
  audioPaused,
  keepScreenAwake,
  onAudioStateChange,
  playClip,
  playSong,
  playSound,
  preloadClip,
  showSystemNotification,
  speak,
  stopSong,
  unlockAudio,
  vibrate,
} from '../utils/alerts';
import { isMusicSound, toneDataUrl, toneUidOf } from '../utils/tones';

const ALERTS_KEY = 'poker.alertsEnabled';

export function useAlertsPreference() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(ALERTS_KEY) === '1';
    } catch {
      return false;
    }
  });

  const update = useCallback((next: boolean) => {
    setEnabled(next);
    try {
      localStorage.setItem(ALERTS_KEY, next ? '1' : '0');
    } catch {
      // Private mode — preference lasts for this session only.
    }
  }, []);

  return [enabled, update] as const;
}

/**
 * Alerts are on but the phone has paused sound (reload, screen lock, another app, a call).
 * Any tap turns it back on; until then the blinds-up alert would be silent.
 */
export function useSoundPaused(alertsEnabled: boolean) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!alertsEnabled) {
      setPaused(false);
      return;
    }
    const check = () => setPaused(audioPaused());
    // Only a finger lifting (or a click / key) lets a page start sound; a finger going down does not.
    const rearm = () => {
      if (audioPaused()) void unlockAudio().then(check);
    };
    check();
    const unsubscribe = onAudioStateChange(check);
    document.addEventListener('visibilitychange', check);
    // Some phones (iOS "interrupted") don't always report the change, so look again now and then.
    const id = window.setInterval(check, 3000);
    const events = ['pointerup', 'touchend', 'click', 'keydown'] as const;
    events.forEach((name) => window.addEventListener(name, rearm, true));
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(id);
      events.forEach((name) => window.removeEventListener(name, rearm, true));
    };
  }, [alertsEnabled]);

  return paused;
}

/** Clock offset between this device and the Firebase server, so every phone shows the same time. */
export function useServerOffset() {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    return onValue(ref(db, '.info/serverTimeOffset'), (snap) => setOffset(Number(snap.val()) || 0));
  }, []);
  return offset;
}

/** What gets announced after "Time is up!", e.g. "Blinds are now 500, 1000." */
function newLevelPhrase(level: BlindLevel) {
  if (level.isBreak) return 'Break time.';
  const ante = level.ante > 0 ? `, ante ${level.ante}` : '';
  return `Blinds are now ${level.sb}, ${level.bb}${ante}.`;
}

/**
 * Song mode: "Time is up! Time is up!" then the song (no countdown, no amounts).
 * Fanfare mode: "Time is up! Time is up! Blinds are now 500, 1000." then the fanfare.
 * Breaks get a chime.
 */
function announceLevel(level: BlindLevel, sound: LevelSound) {
  stopSong();
  vibrate([400, 150, 400, 150, 800]);
  const phrase = isMusicSound(sound) && !level.isBreak ? 'Time is up! Time is up!' : `Time is up! Time is up! ${newLevelPhrase(level)}`;
  const toneUid = toneUidOf(sound);
  speak(phrase, () => {
    if (level.isBreak) playSound('break');
    else if (sound === 'fanfare') playSound('level');
    else if (sound === 'doot') playSound('doot');
    else if (toneUid) void toneDataUrl(toneUid).then((data) => playClip(data));
    else void playSong();
  });
}

type Options = {
  clock: ClockState | undefined;
  levels: BlindLevel[];
  active: boolean;
  alertsEnabled: boolean;
  roomTitle: string;
  levelSound: LevelSound;
  /** Shown on every phone (alerts on or off) when the admin pauses or resumes the clock. */
  onNotice?: (message: string) => void;
};

export function useTournamentClock({ clock, levels, active, alertsEnabled, roomTitle, levelSound, onNotice }: Options) {
  const offset = useServerOffset();
  const serverNow = useCallback(() => Date.now() + offset, [offset]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, 250);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [active]);

  const view: ClockView = useMemo(() => computeClock(clock, levels, now + offset), [clock, levels, now, offset]);

  // --- Alerts on level change and one minute before the level ends ---
  const lastLevelRef = useRef<number | null>(null);
  const lastRemainingRef = useRef<number | null>(null);
  const lastCountdownRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active) {
      lastLevelRef.current = null;
      lastRemainingRef.current = null;
      return;
    }

    const prevLevel = lastLevelRef.current;
    const prevRemaining = lastRemainingRef.current;
    lastLevelRef.current = view.levelIndex;
    lastRemainingRef.current = view.remainingMs;

    if (!alertsEnabled || prevLevel === null) return;

    if (prevLevel !== view.levelIndex) {
      const { level, nextLevel } = view;
      const title = level.isBreak ? '☕ Break time' : `⬆️ Blinds up — Level ${view.levelNumber}`;
      const body = level.isBreak
        ? `${level.minutes} min break${nextLevel ? ` · next ${blindsLabel(nextLevel)}` : ''}`
        : `${blindsLabel(level)} · ${level.minutes} min`;
      if (view.levelIndex > prevLevel) {
        announceLevel(level, levelSound);
      } else {
        // Admin stepped back a level: just a short cue.
        playSound('warning');
      }
      if (document.visibilityState === 'hidden') {
        void showSystemNotification(title, `${roomTitle} · ${body}`);
      }
      return;
    }

    // Spoken countdown over the last five seconds: "5, 4, 3, 2, 1".
    const secondsLeft = Math.ceil(view.remainingMs / 1000);
    const countdownKey = `${view.levelIndex}:${secondsLeft}`;
    if (!isMusicSound(levelSound) && view.running && view.nextLevel && secondsLeft >= 1 && secondsLeft <= 5 && lastCountdownRef.current !== countdownKey) {
      lastCountdownRef.current = countdownKey;
      playSound('tick');
      speak(String(secondsLeft));
    }

    const crossedOneMinute =
      view.running && prevRemaining !== null && prevRemaining > 60_000 && view.remainingMs <= 60_000 && view.durationMs > 120_000;
    if (crossedOneMinute) {
      playSound('warning');
      vibrate([200, 100, 200]);
      if (document.visibilityState === 'hidden' && view.nextLevel) {
        void showSystemNotification('⏱ 1 minute left', `Next: ${blindsLabel(view.nextLevel)}`);
      }
    }
  }, [active, alertsEnabled, view, roomTitle, levelSound]);

  // Download the room's uploaded tone ahead of time, so it starts instantly at blinds-up.
  useEffect(() => {
    const uid = toneUidOf(levelSound);
    if (!active || !alertsEnabled || !uid) return;
    void toneDataUrl(uid).then((data) => {
      if (data) void preloadClip(data);
    });
  }, [active, alertsEnabled, levelSound]);

  // Tell everyone when the admin pauses or resumes the clock.
  const running = !!clock?.running;
  const lastRunningRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!active) {
      lastRunningRef.current = null;
      return;
    }
    const prev = lastRunningRef.current;
    lastRunningRef.current = running;
    if (prev === null || prev === running) return;
    const message = running ? '▶ Clock resumed' : '⏸ Clock paused by the admin';
    onNotice?.(message);
    if (!alertsEnabled) return;
    playSound(running ? 'resume' : 'pause');
    vibrate(running ? [150, 80, 300] : [300, 80, 150]);
    speak(running ? 'Clock resumed.' : 'Clock paused.');
    if (document.visibilityState === 'hidden') void showSystemNotification(message, roomTitle);
  }, [active, running, alertsEnabled, onNotice, roomTitle]);

  // Keep the phone screen on while the clock runs, so timers and sounds are not suspended.
  useEffect(() => {
    const want = active && alertsEnabled && view.running;
    void keepScreenAwake(want);
    if (!want) return;
    const reacquire = () => {
      if (document.visibilityState === 'visible') void keepScreenAwake(true);
    };
    document.addEventListener('visibilitychange', reacquire);
    return () => document.removeEventListener('visibilitychange', reacquire);
  }, [active, alertsEnabled, view.running]);

  useEffect(() => () => void keepScreenAwake(false), []);

  /** Play exactly what the table will hear at the end of a level: countdown, then the announcement. */
  const previewAlert = useCallback(() => {
    const next = view.nextLevel && !view.nextLevel.isBreak ? view.nextLevel : view.level;
    if (isMusicSound(levelSound)) {
      announceLevel(next, levelSound);
      return;
    }
    [5, 4, 3, 2, 1].forEach((n, i) =>
      window.setTimeout(() => {
        playSound('tick');
        speak(String(n));
      }, i * 1000)
    );
    window.setTimeout(() => announceLevel(next, levelSound), 5000);
  }, [view.level, view.nextLevel, levelSound]);

  return { view, serverNow, previewAlert };
}
