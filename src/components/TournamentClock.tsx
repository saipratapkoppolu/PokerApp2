import { useEffect, useState } from 'react';
import { Bell, BellOff, Coffee, Maximize2, Pause, Play, Plus, RotateCcw, SkipBack, SkipForward, VolumeX, X } from 'lucide-react';
import type { ClockView } from '../utils/blinds';
import { blindsLabel, chips, formatClock } from '../utils/blinds';

type Props = {
  view: ClockView;
  isAdmin: boolean;
  alertsEnabled: boolean;
  /** Alerts are on but the phone paused sound: the next tap turns it back on. */
  soundPaused?: boolean;
  onToggleAlerts: () => void;
  onStart: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onRestart: () => void;
  onAddMinute: () => void;
  canPrev: boolean;
  canNext: boolean;
};

function BlindsDisplay({ view, big }: { view: ClockView; big?: boolean }) {
  const { level } = view;
  if (level.isBreak) {
    return (
      <div className={`clock-blinds ${big ? 'big' : ''}`}>
        <Coffee size={big ? 40 : 22} /> Break
      </div>
    );
  }
  return (
    <div className={`clock-blinds ${big ? 'big' : ''}`}>
      <span>{chips(level.sb)}</span>
      <span className="clock-slash">/</span>
      <span>{chips(level.bb)}</span>
      {level.ante > 0 && <span className="clock-ante">ante {chips(level.ante)}</span>}
    </div>
  );
}

function Controls(props: Props) {
  const { view, onStart, onPause, onNext, onPrev, onRestart, onAddMinute, canPrev, canNext } = props;
  return (
    <div className="clock-controls">
      <button className="round-btn" onClick={onPrev} disabled={!canPrev} aria-label="Previous level">
        <SkipBack size={20} />
      </button>
      <button className="round-btn" onClick={onRestart} aria-label="Restart level">
        <RotateCcw size={20} />
      </button>
      {view.running ? (
        <button className="round-btn primary" onClick={onPause} aria-label="Pause clock">
          <Pause size={28} />
        </button>
      ) : (
        <button className="round-btn primary" onClick={onStart} disabled={view.finished} aria-label="Start clock">
          <Play size={28} />
        </button>
      )}
      <button className="round-btn" onClick={onAddMinute} aria-label="Add one minute">
        <Plus size={16} />
        <span className="round-btn-text">1m</span>
      </button>
      <button className="round-btn" onClick={onNext} disabled={!canNext} aria-label="Next level">
        <SkipForward size={20} />
      </button>
    </div>
  );
}

export default function TournamentClock(props: Props) {
  const { view, isAdmin, alertsEnabled, soundPaused, onToggleAlerts } = props;
  const [fullscreen, setFullscreen] = useState(false);
  const warning = view.running && view.remainingMs <= 60_000 && !view.level.isBreak;
  const paused = !view.running && !view.finished;
  const status = view.finished ? 'Final level ended' : view.running ? 'Running' : 'Paused';

  useEffect(() => {
    if (!fullscreen) return;
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
    };
  }, [fullscreen]);

  const title = view.level.isBreak ? 'Break' : `Level ${view.levelNumber}`;
  const next = view.nextLevel ? blindsLabel(view.nextLevel) : 'Final level';
  // Any tap re-enables sound (see useSoundPaused); this button just says so where everyone looks.
  const soundWarning = alertsEnabled && soundPaused && (
    <button type="button" className="sound-paused">
      <VolumeX size={18} /> Sound is paused — tap here so the blinds alert plays
    </button>
  );

  return (
    <>
      <section className={`clock-card ${view.level.isBreak ? 'is-break' : ''} ${warning ? 'is-warning' : ''} ${paused ? 'is-paused' : ''}`}>
        <div className="clock-top">
          <div>
            <div className="clock-level">{title}</div>
            <div className={`clock-status ${view.running ? 'on' : ''}`}>
              <span className="dot" /> {status}
            </div>
          </div>
          <div className="clock-top-actions">
            <button
              className={`icon-chip ${alertsEnabled ? 'on' : ''}`}
              onClick={onToggleAlerts}
              aria-label={alertsEnabled ? 'Turn alerts off' : 'Turn alerts on'}
            >
              {alertsEnabled ? <Bell size={18} /> : <BellOff size={18} />}
              <span>{alertsEnabled ? 'Alerts on' : 'Alerts off'}</span>
            </button>
            <button className="icon-chip" onClick={() => setFullscreen(true)} aria-label="Full screen clock">
              <Maximize2 size={18} />
            </button>
          </div>
        </div>

        {soundWarning}
        {paused && <div className="paused-badge">Paused</div>}
        <div className="clock-time" aria-live="off">
          {formatClock(view.remainingMs)}
        </div>
        <div className="clock-progress">
          <div style={{ width: `${view.progress * 100}%` }} />
        </div>

        <BlindsDisplay view={view} />
        <div className="clock-next">
          Next: <strong>{next}</strong>
        </div>

        {isAdmin && <Controls {...props} />}
      </section>

      {fullscreen && (
        <div className={`clock-fullscreen ${view.level.isBreak ? 'is-break' : ''} ${warning ? 'is-warning' : ''} ${paused ? 'is-paused' : ''}`}>
          <button className="round-btn clock-close" onClick={() => setFullscreen(false)} aria-label="Close full screen">
            <X size={22} />
          </button>
          <div className="clock-level big">{title}</div>
          {soundWarning}
          {paused && <div className="paused-badge big">Paused</div>}
          <div className="clock-time big">{formatClock(view.remainingMs)}</div>
          <div className="clock-progress big">
            <div style={{ width: `${view.progress * 100}%` }} />
          </div>
          <BlindsDisplay view={view} big />
          <div className="clock-next big">
            Next: <strong>{next}</strong>
          </div>
          {isAdmin && <Controls {...props} />}
        </div>
      )}
    </>
  );
}
