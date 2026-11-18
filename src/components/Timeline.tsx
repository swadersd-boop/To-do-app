import { useEffect, useMemo, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Pin, Wand2, X } from 'lucide-react';
import type { Task } from '../types';
import { breaksOf, useStore } from '../store';
import { useUI } from '../ui';
import { layoutBlocks, lengthOf, tasksOn, timelineRange } from '../lib/model';
import { relativeDay, shortDate } from '../lib/dates';
import { fmtClock, snap } from '../lib/time';
import { useNow } from './bits';
import { moveToTomorrow, nameTasks } from '../actions';

/** Height of one minute on the timeline, in pixels. */
export const PX_PER_MIN = 1.5;
const STEP = 15;

type Gesture = { id: string; mode: 'move' | 'resize'; originY: number; start: number; length: number; moved: boolean };

function Block({
  task,
  col,
  cols,
  dayStartMin,
  dayEndMin,
}: {
  task: Task;
  col: number;
  cols: number;
  dayStartMin: number;
  dayEndMin: number;
}) {
  const updateTask = useStore((s) => s.updateTask);
  const color = useStore((s) => s.channels.find((c) => c.id === task.channelId)?.color);
  const openTask = useUI((s) => s.openTask);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const el = useRef<HTMLDivElement>(null);
  /** A touch has to rest on a block for a moment before it moves it, so a swipe still scrolls. */
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const armed = useRef(false);

  const start = gesture?.start ?? task.start!;
  const length = gesture?.length ?? lengthOf(task);

  // React's touch handlers are passive, so blocking the scroll during a drag needs a real listener.
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const hold = (e: TouchEvent) => {
      if (armed.current) e.preventDefault();
    };
    node.addEventListener('touchmove', hold, { passive: false });
    return () => node.removeEventListener('touchmove', hold);
  }, []);

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  const begin = (mode: Gesture['mode']) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    const arm = (clientY: number) => {
      armed.current = true;
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // The pointer may already be gone.
      }
      setGesture({ id: task.id, mode, originY: clientY, start: task.start!, length: lengthOf(task), moved: false });
    };
    if (e.pointerType !== 'touch') return arm(e.clientY);
    const { clientX, clientY } = e;
    cancelPress();
    press.current = {
      x: clientX,
      y: clientY,
      timer: window.setTimeout(() => {
        press.current = null;
        navigator.vibrate?.(12);
        arm(clientY);
      }, 380),
    };
  };

  const onMove = (e: React.PointerEvent) => {
    if (press.current) {
      // Moving before the hold completes means the person is scrolling.
      if (Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 8) cancelPress();
      return;
    }
    if (!gesture) return;
    const dy = (e.clientY - gesture.originY) / PX_PER_MIN;
    if (!gesture.moved && Math.abs(dy) < 4) return;
    if (gesture.mode === 'move') {
      const base = task.start!;
      const next = Math.min(dayEndMin - STEP, Math.max(dayStartMin, snap(base + dy, STEP)));
      setGesture({ ...gesture, start: next, moved: true });
    } else {
      const base = lengthOf(task);
      setGesture({ ...gesture, length: Math.max(STEP, snap(base + dy, STEP)), moved: true });
    }
  };

  const onUp = () => {
    if (press.current) {
      // A short tap opens the task.
      cancelPress();
      openTask(task.id);
      return;
    }
    armed.current = false;
    if (!gesture) return;
    if (!gesture.moved) {
      if (gesture.mode === 'move') openTask(task.id);
    } else if (gesture.mode === 'move') updateTask(task.id, { start: gesture.start });
    // Resizing changes the timebox. The estimate stays as it was, so Insights stays honest.
    else updateTask(task.id, task.planned === null ? { planned: gesture.length } : { blockMin: gesture.length });
    setGesture(null);
  };

  const onCancel = () => {
    cancelPress();
    armed.current = false;
    setGesture(null);
  };

  const width = 100 / cols;
  return (
    <div
      ref={el}
      className={`block ${task.fixed ? 'is-fixed' : ''} ${task.done ? 'is-done' : ''} ${gesture ? 'is-held' : ''} ${gesture?.moved ? 'is-moving' : ''} ${length <= 30 ? 'is-short' : ''} ${length <= 15 ? 'is-tiny' : ''}`}
      style={{
        top: (start - dayStartMin) * PX_PER_MIN,
        height: Math.max(STEP, length) * PX_PER_MIN - 2,
        left: `calc(${col * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        borderLeftColor: color ?? 'var(--accent)',
      }}
      role="button"
      tabIndex={0}
      aria-label={`${task.title}, ${fmtClock(start)} to ${fmtClock(start + length)}`}
      onPointerDown={begin('move')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter') openTask(task.id);
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const delta = e.key === 'ArrowUp' ? -STEP : STEP;
          if (e.shiftKey) {
            const next = Math.max(STEP, lengthOf(task) + delta);
            updateTask(task.id, task.planned === null ? { planned: next } : { blockMin: next });
          }
          else updateTask(task.id, { start: Math.min(dayEndMin - STEP, Math.max(dayStartMin, task.start! + delta)) });
        }
        if (e.key === 'Backspace' || e.key === 'Delete') updateTask(task.id, { start: null });
      }}
    >
      <span className="block-title">
        {task.fixed && <Pin size={11} className="block-pin" aria-label="Fixed time" />}
        {task.title}
      </span>
      <span className="block-time">
        {fmtClock(start)} to {fmtClock(start + length)}
      </span>
      <button
        type="button"
        className="block-x"
        aria-label="Remove from timeline"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          updateTask(task.id, { start: null });
        }}
      >
        <X size={12} />
      </button>
      <span className="block-grip" onPointerDown={begin('resize')} aria-hidden="true" />
    </div>
  );
}

export function Timeline() {
  const day = useUI((s) => s.selectedDay);
  const today = useUI((s) => s.today);
  const notify = useUI((s) => s.notify);
  const dropAt = useUI((s) => s.dropAt);
  const channels = useStore((s) => s.channels);
  const channelColor = (id: string | null) => channels.find((c) => c.id === id)?.color;
  const log = useStore((s) => s.days[day]);
  const tasks = useStore((s) => s.tasks);
  const autoSchedule = useStore((s) => s.autoSchedule);
  const clearSchedule = useStore((s) => s.clearSchedule);
  const scroller = useRef<HTMLDivElement>(null);
  const { setNodeRef, isOver } = useDroppable({ id: 'timeline', data: { type: 'timeline' } });

  const now = useNow(30_000);
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  const settings = useStore((s) => s.settings);
  const list = useMemo(() => tasksOn(tasks, day), [tasks, day]);
  // Stretch past the usual hours when something is planned outside them.
  const { start: dayStart, end: dayEnd } = useMemo(() => timelineRange(list, settings.dayStart, settings.dayEnd), [list, settings.dayStart, settings.dayEnd]);
  const dayStartMin = dayStart * 60;
  const dayEndMin = dayEnd * 60;
  const boxed = list.filter((t) => t.start !== null);
  // Work done here on tasks that later moved on to another day, shown where it happened.
  const traces = useMemo(
    () =>
      (day < today ? (log?.carriedWork ?? []) : [])
        .filter((w) => w.start !== null)
        .map((w, i) => ({ id: `trace-${i}`, title: w.title, start: w.start!, length: Math.max(STEP, Math.round(w.sec / 60)) })),
    [log, day, today],
  );
  const layout = useMemo(
    () =>
      layoutBlocks([
        ...boxed.map((t) => ({ id: t.id, start: t.start!, end: t.start! + Math.max(STEP, lengthOf(t)) })),
        ...boxed.flatMap((t) => (t.parts ?? []).map((p, i) => ({ id: `${t.id}:part${i}`, start: p.start, end: p.start + Math.max(STEP, p.length) }))),
        ...traces.map((w) => ({ id: w.id, start: w.start, end: w.start + w.length })),
      ]),
    [boxed],
  );
  const hours = Array.from({ length: dayEnd - dayStart }, (_, i) => dayStart + i);
  const showNow = day === today && nowMin >= dayStartMin && nowMin <= dayEndMin;

  useEffect(() => {
    if (day !== today || !scroller.current) return;
    scroller.current.scrollTop = Math.max(0, (nowMin - dayStartMin) * PX_PER_MIN - 120);
    // Scroll to "now" only when the day changes, not every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, today]);

  const withUndo = (message: string, before: typeof tasks) =>
    notify(message, { label: 'Undo', run: () => useStore.setState({ tasks: before }) });

  const fill = () => {
    const before = useStore.getState().tasks;
    const from = day === today ? nowMin : dayStartMin;
    const { placed, left } = autoSchedule(day, from);
    const undo = { label: 'Undo', run: () => useStore.setState({ tasks: before }) };
    if (left.length === 0) return notify(`Planned ${placed} task${placed === 1 ? '' : 's'} from ${fmtClock(Math.max(from, settings.dayStart * 60))}, in list order`, undo);
    // Say exactly what dropped off, and offer the obvious way out.
    notify(
      `${nameTasks(left)} ${left.length === 1 ? 'does' : 'do'} not fit in the rest of today.`,
      { label: 'Move to tomorrow', run: () => moveToTomorrow(left.map((t) => t.id)) },
      undo,
    );
  };

  const clear = () => {
    const before = useStore.getState().tasks;
    clearSchedule(day);
    withUndo('Cleared the planned times. Fixed ones stay.', before);
  };

  const flexibleBoxed = boxed.some((t) => !t.done && !t.fixed);
  const canFill = list.some((t) => !t.done && !t.fixed);

  return (
    <aside className="timeline" aria-label={`Timeline for ${relativeDay(day, today)}`}>
      <header className="timeline-head">
        <div>
          <h3>{relativeDay(day, today)}</h3>
          <span className="side-sub">{shortDate(day)}</span>
        </div>
        <div className="row">
          {flexibleBoxed && (
            <button type="button" className="btn btn-quiet" onClick={clear} title="Remove planned times. Fixed times stay.">
              Clear
            </button>
          )}
          <button
            type="button"
            className="btn btn-quiet"
            onClick={fill}
            disabled={!canFill}
            title="Lays out the rest of the day in list order, from now. Fixed times and lunch stay where they are."
          >
            <Wand2 size={14} />
            {day === today && boxed.some((t) => !t.done && !t.fixed) ? 'Replan from now' : 'Fill my day'}
          </button>
        </div>
      </header>

      <div className="timeline-scroll" ref={scroller}>
        <div
          ref={setNodeRef}
          className={`grid ${isOver ? 'is-over' : ''}`}
          data-timeline-grid
          data-day-start={dayStartMin}
          data-day-end={dayEndMin}
          style={{ height: (dayEndMin - dayStartMin) * PX_PER_MIN }}
        >
          {hours.map((h) => (
            <div key={h} className="hour" style={{ top: (h * 60 - dayStartMin) * PX_PER_MIN, height: 60 * PX_PER_MIN }}>
              <span className="hour-label">{fmtClock(h * 60)}</span>
            </div>
          ))}
          <div className="grid-lane">
            {breaksOf(settings)
              .filter((b) => b.end > dayStartMin && b.start < dayEndMin)
              .map((b) => (
                <div
                  key={b.start}
                  className="break"
                  style={{ top: (Math.max(b.start, dayStartMin) - dayStartMin) * PX_PER_MIN, height: (Math.min(b.end, dayEndMin) - Math.max(b.start, dayStartMin)) * PX_PER_MIN }}
                  aria-hidden="true"
                >
                  Lunch
                </div>
              ))}
            {traces.map((w) => {
              const width = 100 / (layout[w.id]?.cols ?? 1);
              return (
                <div
                  key={w.id}
                  className="block is-trace"
                  style={{
                    top: (w.start - dayStartMin) * PX_PER_MIN,
                    height: w.length * PX_PER_MIN - 2,
                    left: `calc(${(layout[w.id]?.col ?? 0) * width}% + 2px)`,
                    width: `calc(${width}% - 4px)`,
                  }}
                  title="Worked on here, then moved on to a later day"
                >
                  <span className="block-title">↪ {w.title}</span>
                  <span className="block-time">
                    {fmtClock(w.start)} to {fmtClock(w.start + w.length)}, moved on
                  </span>
                </div>
              );
            })}
            {boxed.flatMap((t) =>
              (t.parts ?? []).map((p, i) => {
                const key = `${t.id}:part${i}`;
                const width = 100 / (layout[key]?.cols ?? 1);
                return (
                  <div
                    key={key}
                    className={`block is-part ${t.done ? 'is-done' : ''} ${p.length <= 30 ? 'is-short' : ''}`}
                    style={{
                      top: (p.start - dayStartMin) * PX_PER_MIN,
                      height: Math.max(STEP, p.length) * PX_PER_MIN - 2,
                      left: `calc(${(layout[key]?.col ?? 0) * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                      borderLeftColor: channelColor(t.channelId) ?? 'var(--accent)',
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${t.title}, continued, ${fmtClock(p.start)} to ${fmtClock(p.start + p.length)}`}
                    onClick={() => useUI.getState().openTask(t.id)}
                    onKeyDown={(e) => e.key === 'Enter' && useUI.getState().openTask(t.id)}
                    title="The same task, continued after a meeting or break"
                  >
                    <span className="block-title">{t.title} (continued)</span>
                    <span className="block-time">
                      {fmtClock(p.start)} to {fmtClock(p.start + p.length)}
                    </span>
                  </div>
                );
              }),
            )}
            {boxed.map((t) => (
              <Block key={t.id} task={t} col={layout[t.id]?.col ?? 0} cols={layout[t.id]?.cols ?? 1} dayStartMin={dayStartMin} dayEndMin={dayEndMin} />
            ))}
            {boxed.length === 0 && (
              <p className="grid-hint">
                <span className="wide-only">Drag a task here to give it a time, or press "Fill my day".</span>
                <span className="narrow-only">Press "Fill my day", or open a task and set "Starts at".</span>
              </p>
            )}
          </div>
          {dropAt !== null && (
            <div className="drop-at" style={{ top: (dropAt - dayStartMin) * PX_PER_MIN }} aria-hidden="true">
              <span>{fmtClock(dropAt)}</span>
            </div>
          )}
          {showNow && (
            <div className="now" style={{ top: (nowMin - dayStartMin) * PX_PER_MIN }} aria-hidden="true">
              <span>{fmtClock(nowMin)}</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
