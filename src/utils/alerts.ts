/**
 * Sound, vibration, system notifications and screen wake-lock for the tournament clock.
 * Mobile browsers only allow audio after a user gesture, so `unlockAudio()` must be
 * called from a tap (the "Enable alerts" button).
 */

let ctx: AudioContext | null = null;
const stateListeners = new Set<() => void>();
const notifyState = () => stateListeners.forEach((listener) => listener());

function getContext() {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    ctx.addEventListener('statechange', notifyState);
  }
  return ctx;
}

/**
 * True when sound can't play right now: not unlocked since the page loaded, or the phone suspended
 * audio (screen lock, another app, a call). Only a tap can turn it back on.
 */
export function audioPaused() {
  return !ctx || ctx.state !== 'running';
}

/** Called whenever the audio state may have changed. Returns an unsubscribe function. */
export function onAudioStateChange(listener: () => void) {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export async function unlockAudio() {
  // iOS 17+: play through the silent switch like a media app.
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) session.type = 'playback';

  const audio = getContext();
  if (!audio) return false;
  if (audio.state !== 'running') await audio.resume();
  // A silent blip fully unlocks output on iOS Safari.
  const buffer = audio.createBuffer(1, 1, 22050);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  source.start(0);
  // iOS only allows speech after one utterance started from a tap: speak a silent one now.
  try {
    const warmup = new SpeechSynthesisUtterance(' ');
    warmup.volume = 0;
    window.speechSynthesis?.speak(warmup);
  } catch {
    // Speech not supported.
  }
  void preloadSong();
  notifyState();
  return audio.state === 'running';
}

function tone(audio: AudioContext, freq: number, start: number, length: number, volume: number, type: OscillatorType = 'sine') {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

export type AlertSound = 'level' | 'break' | 'warning' | 'tick' | 'doot' | 'pause' | 'resume' | 'test';

export function playSound(kind: AlertSound) {
  const audio = getContext();
  if (!audio) return;
  if (audio.state !== 'running') void audio.resume();
  const t = audio.currentTime + 0.05;

  if (kind === 'doot') {
    // "Doot doot … doot doot": two pairs of short, nasal trumpet notes with a little upward scoop.
    [0, 0.34, 1.0, 1.34].forEach((at) => trumpet(audio, 466.16, t + at, 0.24, 0.5));
    return;
  }

  if (kind === 'pause') {
    tone(audio, 659.25, t, 0.22, 0.35, 'triangle');
    tone(audio, 440, t + 0.24, 0.4, 0.35, 'triangle');
    return;
  }

  if (kind === 'resume') {
    tone(audio, 440, t, 0.22, 0.35, 'triangle');
    tone(audio, 659.25, t + 0.24, 0.4, 0.35, 'triangle');
    return;
  }

  if (kind === 'tick') {
    tone(audio, 1320, t, 0.08, 0.25, 'square');
    return;
  }

  if (kind === 'warning') {
    tone(audio, 880, t, 0.18, 0.35, 'triangle');
    tone(audio, 880, t + 0.28, 0.18, 0.35, 'triangle');
    return;
  }

  if (kind === 'break') {
    [523.25, 659.25, 783.99].forEach((f, i) => tone(audio, f, t + i * 0.35, 0.9, 0.5));
    return;
  }

  // Level up: brass fanfare (G-C-E-G, then a held C major chord) with firework pops and crackle.
  const fanfare: [number, number, number][] = [
    [392.0, 0, 0.14],
    [523.25, 0.15, 0.14],
    [659.25, 0.3, 0.14],
    [783.99, 0.45, 0.32],
    [659.25, 0.8, 0.12],
    [783.99, 0.93, 0.9],
  ];
  fanfare.forEach(([f, at, len]) => brass(audio, f, t + at, len, 0.32));
  [523.25, 659.25, 783.99, 1046.5].forEach((f) => brass(audio, f, t + 0.93, 1.1, 0.14));

  // Fireworks: launch whistles, pops and sparkle to match the on-screen show.
  [1.0, 1.4, 1.8].forEach((at, i) => {
    whistle(audio, t + at - 0.35);
    pop(audio, t + at, 0.55 - i * 0.05);
    crackle(audio, t + at + 0.08);
  });
}

/** Nasal "doot": saw + square through a bandpass (trumpet mouthpiece), pitch scooping up into the note. */
function trumpet(audio: AudioContext, freq: number, start: number, length: number, volume: number) {
  const band = audio.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(freq * 3, start);
  band.Q.value = 1.4;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
  gain.gain.setValueAtTime(volume * 0.85, start + length * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  band.connect(gain).connect(audio.destination);
  (['sawtooth', 'square'] as OscillatorType[]).forEach((type, i) => {
    const osc = audio.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * 0.94, start);
    osc.frequency.exponentialRampToValueAtTime(freq, start + 0.04);
    osc.detune.value = i === 0 ? -4 : 4;
    osc.connect(band);
    osc.start(start);
    osc.stop(start + length + 0.05);
  });
}

/** Brass-like note: detuned sawtooth pair through a sweeping low-pass filter. */
function brass(audio: AudioContext, freq: number, start: number, length: number, volume: number) {
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(freq * 1.5, start);
  filter.frequency.exponentialRampToValueAtTime(freq * 6, start + 0.06);
  filter.frequency.exponentialRampToValueAtTime(freq * 2.5, start + length);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.03);
  gain.gain.setValueAtTime(volume * 0.8, start + Math.max(0.04, length - 0.08));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length + 0.12);
  filter.connect(gain).connect(audio.destination);
  [-6, 6].forEach((cents) => {
    const osc = audio.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, start);
    osc.detune.setValueAtTime(cents, start);
    osc.connect(filter);
    osc.start(start);
    osc.stop(start + length + 0.2);
  });
}

let noiseBuffer: AudioBuffer | null = null;
function noise(audio: AudioContext) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== audio.sampleRate) {
    noiseBuffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  const source = audio.createBufferSource();
  source.buffer = noiseBuffer;
  return source;
}

function pop(audio: AudioContext, start: number, volume: number) {
  const src = noise(audio);
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1800, start);
  filter.frequency.exponentialRampToValueAtTime(200, start + 0.4);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
  src.connect(filter).connect(gain).connect(audio.destination);
  src.start(start);
  src.stop(start + 0.5);
}

function crackle(audio: AudioContext, start: number) {
  for (let i = 0; i < 14; i += 1) {
    const at = start + Math.random() * 0.6;
    const src = noise(audio);
    const filter = audio.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 3000 + Math.random() * 3000;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.18 * Math.random() + 0.05, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
    src.connect(filter).connect(gain).connect(audio.destination);
    src.start(at, Math.random() * 0.5);
    src.stop(at + 0.04);
  }
}

function whistle(audio: AudioContext, start: number) {
  const osc = audio.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(900, start);
  osc.frequency.exponentialRampToValueAtTime(2400, start + 0.33);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.05, start + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(start + 0.36);
}

/** Speak text aloud with the phone's built-in voice (no downloads). */
export function speak(text: string, onEnd?: () => void) {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
    onEnd?.();
    return;
  }
  // Speech 'end' events are unreliable on some phones, so fall back to a timer.
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onEnd?.();
  };
  if (onEnd) window.setTimeout(finish, 800 + text.length * 90);
  try {
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;
    const voices = synth.getVoices();
    const english = voices.find((v) => /en[-_](US|GB|IN|AU)/i.test(v.lang) && /female|samantha|google|zira|karen/i.test(v.name)) ?? voices.find((v) => v.lang?.startsWith('en'));
    if (english) utterance.voice = english;
    utterance.onend = finish;
    utterance.onerror = finish;
    synth.speak(utterance);
  } catch (error) {
    console.warn('Speech failed', error);
    finish();
  }
}

// ---------- Music clips: the built-in song and player-uploaded tones ----------

/** "Blinds Rise" by gsrk_au, bundled with the app. */
export const SONG_URL = '/sounds/blinds-up.mp3';
const clips = new Map<string, Promise<AudioBuffer | null>>();
let clipSource: AudioBufferSourceNode | null = null;

/** Download and decode a clip once (URL or data: URL), so it can start instantly and without a tap later. */
export function preloadClip(src: string) {
  const audio = getContext();
  if (!audio) return Promise.resolve(null);
  let loading = clips.get(src);
  if (!loading) {
    loading = fetch(src)
      .then((res) => res.arrayBuffer())
      .then((data) => audio.decodeAudioData(data))
      .catch((error) => {
        console.warn('Clip failed to load', error);
        clips.delete(src);
        return null;
      });
    clips.set(src, loading);
  }
  return loading;
}

export function preloadSong() {
  return preloadClip(SONG_URL);
}

/** Play a clip; falls back to the fanfare if it can't be loaded. */
export async function playClip(src: string | null) {
  const audio = getContext();
  if (!audio) return;
  if (audio.state !== 'running') void audio.resume();
  const buffer = src ? await preloadClip(src) : null;
  if (!buffer) {
    playSound('level');
    return;
  }
  stopSong();
  const source = audio.createBufferSource();
  const gain = audio.createGain();
  gain.gain.value = 0.9;
  source.buffer = buffer;
  source.connect(gain).connect(audio.destination);
  source.onended = () => {
    if (clipSource === source) clipSource = null;
  };
  source.start();
  clipSource = source;
}

export function playSong() {
  return playClip(SONG_URL);
}

export function stopSong() {
  try {
    clipSource?.stop();
  } catch {
    // Already stopped.
  }
  clipSource = null;
}

/** Length in seconds of an audio file, or null if the browser can't decode it. */
export async function audioDuration(data: ArrayBuffer) {
  const audio = getContext();
  if (!audio) return null;
  try {
    const buffer = await audio.decodeAudioData(data.slice(0));
    return buffer.duration;
  } catch {
    return null;
  }
}

export function vibrate(pattern: number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Unsupported (iOS) — ignore.
  }
}

export function notificationsSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported' as const;
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return Notification.permission;
  return Notification.requestPermission();
}

export async function showSystemNotification(title: string, body: string) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      body,
      tag: 'blind-level',
      icon: '/icon.svg',
      badge: '/icon.svg',
      renotify: true,
      vibrate: [300, 150, 300, 150, 600],
    } as NotificationOptions);
  } catch (error) {
    console.warn('Notification failed', error);
  }
}

type WakeLockSentinelLike = { release: () => Promise<void>; released: boolean };
let wakeLock: WakeLockSentinelLike | null = null;

export async function keepScreenAwake(on: boolean) {
  const api = (navigator as unknown as { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
  if (!api) return false;
  try {
    if (on && (!wakeLock || wakeLock.released)) {
      wakeLock = await api.request('screen');
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
    return true;
  } catch {
    return false;
  }
}
