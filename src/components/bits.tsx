import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { useStore } from '../store';
import { fmtClock, fmtMin, parseDuration } from '../lib/time';
import { parseQuickAdd, unreadTokens } from '../lib/parse';
import { relativeDay } from '../lib/dates';
import { useUI } from '../ui';

/** Re-renders on an interval while `active`, returning the current time. */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

/**
 * Closes the topmost layer on Escape, wherever the focus is. A popover that
 * handled the key first has already stopped it.
 */
export function useEscape(onClose: () => void) {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Seconds tracked on a task, including a timer that is still running. */
export function useTracked(taskId: string, actualSec: number): { seconds: number; running: boolean } {
  const timer = useStore((s) => s.timer);
  const running = timer?.taskId === taskId;
  const now = useNow(1000, running);
  return { seconds: running ? actualSec + Math.max(0, (now - timer!.startedAt) / 1000) : actualSec, running };
}

export function CheckCircle({ checked, onChange, label, size = 20 }: { checked: boolean; onChange: () => void; label: string; size?: number }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={`check ${checked ? 'is-checked' : ''}`}
      style={{ width: size, height: size }}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {checked && <Check size={size - 7} strokeWidth={3} />}
    </button>
  );
}

export function ChannelPill({ channelId }: { channelId: string | null }) {
  const channel = useStore((s) => s.channels.find((c) => c.id === channelId));
  if (!channel) return null;
  return (
    <span className="pill">
      <span className="dot" style={{ background: channel.color }} />
      {channel.name}
    </span>
  );
}

/** A floating panel anchored under a button. Closes on outside click or Escape. */
export function Popover({ anchor, onClose, children }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const p = ref.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(a.left, window.innerWidth - p.width - 8));
    const below = a.bottom + 6;
    const top = below + p.height > window.innerHeight - 8 ? Math.max(8, a.top - p.height - 6) : below;
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="popover"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

const PRESETS = [15, 30, 45, 60, 90, 120];

/** The estimate chip on a task. Click it to pick or type a duration. */
export function EstimateChip({ value, onChange, actualMin }: { value: number | null; onChange: (min: number | null) => void; actualMin?: number }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const btn = useRef<HTMLButtonElement>(null);
  const tracked = actualMin !== undefined && actualMin >= 1;

  const commit = () => {
    const parsed = parseDuration(text);
    if (parsed !== null && parsed > 0) {
      onChange(parsed);
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`chip chip-btn ${value === null ? 'is-empty' : ''}`}
        aria-label={value === null ? 'Set estimate' : `Estimate ${fmtMin(value)}, change`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setText('');
          setOpen((o) => !o);
        }}
      >
        {tracked && <span className="chip-actual">{fmtMin(actualMin!)} /</span>}
        {value === null ? (tracked ? '?' : 'est') : fmtMin(value)}
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)}>
          <div className="est-grid">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={`est-opt ${value === p ? 'is-on' : ''}`}
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                }}
              >
                {fmtMin(p)}
              </button>
            ))}
          </div>
          <form
            className="est-custom"
            onSubmit={(e) => {
              e.preventDefault();
              commit();
            }}
          >
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 20m or 1h15" aria-label="Custom estimate" />
            {value !== null && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                Clear
              </button>
            )}
          </form>
        </Popover>
      )}
    </>
  );
}

/**
 * A centered dialog with a dimmed backdrop. Escape and backdrop clicks close it.
 * `top` and `footer` stay put while the body scrolls. Changing `scrollKey`
 * scrolls the body back to the top, which multi-step dialogs use per step.
 */
export function Dialog({
  title,
  onClose,
  children,
  top,
  footer,
  scrollKey,
  wide = false,
  className = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  top?: ReactNode;
  footer?: ReactNode;
  scrollKey?: unknown;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [scrollKey]);

  useEscape(onClose);

  return createPortal(
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`dialog ${wide ? 'dialog-wide' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        {top && <div className="dialog-top">{top}</div>}
        <div ref={body} className="dialog-body">
          {children}
        </div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** A thin bar showing planned time against the day's capacity. */
export function LoadBar({ planned, capacity }: { planned: number; capacity: number }) {
  const pct = capacity > 0 ? Math.min(100, (planned / capacity) * 100) : 0;
  const over = planned > capacity;
  return (
    <div className={`load ${over ? 'is-over' : ''}`} role="img" aria-label={`${fmtMin(planned)} planned of ${fmtMin(capacity)}`}>
      <div className="load-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** One-line text input that submits on Enter and clears itself. */
export function AddLine({
  placeholder,
  onAdd,
  inputRef,
  label,
  quick = false,
}: {
  placeholder: string;
  onAdd: (text: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  label: string;
  /** Show what quick-add syntax was understood while typing. */
  quick?: boolean;
}) {
  const [text, setText] = useState('');
  const hintId = useId();
  const showHint = quick && text.trim().length > 0;
  return (
    <div className="add-wrap">
    <form
      className="add-line"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onAdd(text);
        setText('');
      }}
    >
      <span className="add-plus" aria-hidden="true">
        +
      </span>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        aria-describedby={showHint ? hintId : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
    </form>
    {showHint && <QuickAddHint id={hintId} text={text} />}
    </div>
  );
}

/** A live reading of a quick-add line: what becomes the title, estimate, channel, time and day. */
function QuickAddHint({ id, text }: { id: string; text: string }) {
  const today = useUI((s) => s.today);
  const channels = useStore((s) => s.channels);
  const p = parseQuickAdd(text, today);
  const unread = unreadTokens(p.title);
  const wanted = p.channel?.toLowerCase() ?? '';
  const known = channels.some((c) => c.name === wanted || c.name.startsWith(wanted));
  const parts: string[] = [];
  if (p.planned !== null) parts.push(fmtMin(p.planned));
  if (p.channel) parts.push(`#${p.channel}${known ? '' : ' (new)'}`);
  if (p.start !== null) parts.push(`fixed at ${fmtClock(p.start)}`);
  if (p.date !== undefined) parts.push(p.date === null ? 'backlog' : relativeDay(p.date, today));
  if (parts.length === 0 && unread.length === 0) return null;
  return (
    <p id={id} className="add-hint" aria-live="polite">
      {parts.length > 0 && (
        <span>
          <span className="add-hint-title">{p.title || 'Untitled'}</span> · {parts.join(' · ')}
        </span>
      )}
      {unread.length > 0 && <span className="add-hint-warn">Could not read {unread.join(', ')} as a time. Try @14:30 or @9-10am.</span>}
    </p>
  );
}

/** A small text field for a duration. Commits on blur or Enter. */
export function DurationInput({ minutes, onChange, label }: { minutes: number | null; onChange: (min: number | null) => void; label: string }) {
  const shown = minutes === null || minutes < 1 ? '' : fmtMin(minutes);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);

  const commit = () => {
    if (!text.trim()) {
      if (minutes !== null) onChange(null);
      return;
    }
    const parsed = parseDuration(text.replace(/\s+/g, ''));
    if (parsed === null) setText(shown);
    else if (parsed !== Math.round(minutes ?? -1)) onChange(parsed);
  };

  return (
    <input
      className="field field-short"
      value={text}
      aria-label={label}
      placeholder="0m"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
