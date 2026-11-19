import { useEffect, useMemo, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Pin, Wand2, X } from 'lucide-react';
import type { Task } from '../types';
import { breaksOf, useStore } from '../store';
import { useUI } from '../ui';
import { estimateUsedUp, layoutBlocks, lengthOf, sessionsOn, tasksOn, timelineRange } from '../lib/model';
import { nextWorkday, relativeDay, shortDate } from '../lib/dates';
import { fmtClock, snap } from '../lib/time';
import { useNow } from './bits';
import { moveToTomorrow, nameTasks } from '../actions';
import { partlyText } from '../lib/summary';

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
  part,
}: {
  task: Task;
  col: number;
  cols: number;
  dayStartMin: number;
  dayEndMin: number;
  /** Which later block of a split task this is; left out for its first block. */
  part?: number;
}) {
  const updateTask = useStore((s) => s.updateTask);
  const color = useStore((s) => s.channels.find((c) => c.id === task.channelId)?.color);
  const openTask = useUI((s) => s.openTask);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const el = useRef<HTMLDivElement>(null);
  /** A touch has to rest on a block for a moment before it moves it, so a swipe still scrolls. */
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const armed = useRef(false);

  // The block this element draws: the task's first block, or one of its later parts.
  const span = part === undefined ? { start: task.start!, length: lengthOf(task) } : task.parts![part];
  const start = gesture?.start ?? span.start;
  const length = gesture?.length ?? span.length;

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
      setGesture({ id: task.id, mode, originY: clientY, start: span.start, length: span.length, moved: false });
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
      const base = span.start;
      const next = Math.min(dayEndMin - STEP, Math.max(dayStartMin, snap(base + dy, STEP)));
      setGesture({ ...gesture, start: next, moved: true });
    } else {
      const base = span.length;
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
    } else {
      const before = useStore.getState().tasks;
      if (gesture.mode === 'move') shift(gesture.start - span.start);
      else resize(gesture.length);
      const clash = overlaps(gesture.mode);
      useUI.getState().notify(`${gesture.mode === 'move' ? `Moved "${task.title}".` : `Resized "${task.title}".`}${clash}`, {
        label: 'Undo',
        run: () => useStore.setState({ tasks: before }),
      });
    }
    setGesture(null);
  };

  /**
   * Moves this block and the ones after it, keeping their shape. Dragging the
   * first block moves the whole task; a later one leaves what came before it.
   */
  function shift(delta: number) {
    const from = part ?? -1;
    updateTask(task.id, {
      start: from < 0 ? task.start! + delta : task.start!,
      parts: task.parts?.map((p, i) => (i >= from ? { ...p, start: p.start + delta } : p)) ?? null,
    });
  }

  /** Resizing changes this block only. The estimate stays as it was, so Insights stays honest. */
  function resize(next: number) {
    if (part !== undefined) updateTask(task.id, { parts: task.parts!.map((p, i) => (i === part ? { ...p, length: next } : p)) });
    else updateTask(task.id, task.planned === null ? { planned: next } : { blockMin: next });
  }

  /** Names what the task now sits on top of, so a move never hides a clash. */
  function overlaps(mode: Gesture['mode']): string {
    const s = useStore.getState();
    const moved = s.tasks.find((t) => t.id === task.id)!;
    const spans = (t: Task) => [
      { start: t.start!, end: t.start! + lengthOf(t) },
      ...(t.parts ?? []).map((p) => ({ start: p.start, end: p.start + p.length })),
    ];
    // Only the blocks that changed: from this block on for a move, this one block for a resize.
    const index = part === undefined ? 0 : part + 1;
    const mine = mode === 'move' ? spans(moved).slice(index) : spans(moved).slice(index, index + 1);
    const hits = (b: { start: number; end: number }) => mine.some((m) => m.start < b.end && b.start < m.end);
    const names = [
      ...breaksOf(s.settings).filter(hits).map(() => 'lunch'),
      ...tasksOn(s.tasks, moved.date)
        .filter((t) => t.id !== moved.id && t.start !== null && !t.done && spans(t).some(hits))
        .map((t) => `"${t.title}"`),
    ];
    return names.length > 0 ? ` It now overlaps ${names.join(' and ')}.` : '';
  }

  const onCancel = () => {
    cancelPress();
    armed.current = false;
    setGesture(null);
  };

  const width = 100 / cols;
  return (
    <div
      ref={el}
      className={`block ${part !== undefined ? 'is-part' : ''} ${task.fixed ? 'is-fixed' : ''} ${task.done ? 'is-done' : ''} ${gesture ? 'is-held' : ''} ${gesture?.moved ? 'is-moving' : ''} ${length <= 30 ? 'is-short' : ''} ${length <= 15 ? 'is-tiny' : ''}`}
      style={{
        top: (start - dayStartMin) * PX_PER_MIN,
        height: Math.max(STEP, length) * PX_PER_MIN - 2,
        left: `calc(${col * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        borderLeftColor: color ?? 'var(--accent)',
      }}
      role="button"
      tabIndex={0}
      aria-label={`${task.title}${part !== undefined ? ', continued' : ''}, ${fmtClock(start)} to ${fmtClock(start + length)}`}
      title={part !== undefined ? 'The same task, continued after a meeting or break. Drag to move all of it.' : undefined}
      onPointerDown={begin('move')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter') openTask(task.id);
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const delta = e.key === 'ArrowUp' ? -STEP : STEP;
          if (e.shiftKey) resize(Math.max(STEP, span.length + delta));
          else if (span.start + delta >= dayStartMin && span.start + delta <= dayEndMin - STEP) shift(delta);
        }
        if (e.key === 'Backspace' || e.key === 'Delete') updateTask(task.id, { start: null });
      }}
    >
      <span className="block-title">
        {task.fixed && <Pin size={11} className="block-pin" aria-label="Fixed time" />}
        {task.title}
        {part !== undefined && ' (continued)'}
      </span>
      <span className="block-time">
        {fmtClock(start)} to {fmtClock(start + length)}
      </span>
      {!task.fixed && part === undefined && (
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
      )}
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
  // Where work actually happened on this day, from the timer: for every task, also ones that later moved on.
  const worked = useMemo(
    () =>
      tasks.flatMap((t) =>
        sessionsOn(t, day).map((w, i) => ({ id: `${t.id}:s${i}`, task: t, start: w.start, length: Math.max(STEP, w.end - w.start) })),
      ),
    [tasks, day],
  );
  const hasWork = (t: Task) => worked.some((w) => w.task.id === t.id);
  // Once there is real work to show, a plan that is already behind us is not drawn as well.
  const stillAhead = (start: number, length: number) => day === today && start + length > nowMin;
  // Each block of a planned task is drawn while it is still ahead, or when no real work replaces it.
  const shows = (t: Task, start: number, length: number) => !hasWork(t) || (!t.done && stillAhead(start, length));
  const showsHead = (t: Task) => shows(t, t.start!, lengthOf(t));
  /** The indexes of the later blocks still drawn. */
  const partsOf = (t: Task) => (t.parts ?? []).flatMap((p, i) => (shows(t, p.start, p.length) ? [i] : []));
  // A started task whose first block is behind us keeps the rest of its plan on the timeline.
  const boxed = list.filter((t) => t.start !== null && (showsHead(t) || partsOf(t).length > 0));
  const heads = boxed.filter(showsHead);
  // Work done here on tasks that later moved on to another day, shown where it happened.
  const traces = useMemo(
    () =>
      (day < today ? (log?.carriedWork ?? []) : [])
        // Older records without timer sessions only.
        .filter((w) => w.start !== null && !worked.some((x) => x.task.title === w.title))
        .map((w, i) => ({ id: `trace-${i}`, title: w.title, start: w.start!, length: Math.max(STEP, Math.round(w.sec / 60)) })),
    [log, day, today, worked],
  );
  const layout = useMemo(
    () =>
      layoutBlocks([
        ...heads.map((t) => ({ id: t.id, start: t.start!, end: t.start! + Math.max(STEP, lengthOf(t)) })),
        ...boxed.flatMap((t) =>
          partsOf(t).map((i) => ({ id: `${t.id}:part${i}`, start: t.parts![i].start, end: t.parts![i].start + Math.max(STEP, t.parts![i].length) })),
        ),
        ...worked.map((w) => ({ id: w.id, start: w.start, end: w.start + w.length })),
        ...traces.map((w) => ({ id: w.id, start: w.start, end: w.start + w.length })),
      ]),
    [boxed, worked, traces],
  );
  const hours = Array.from({ length: dayEnd - dayStart }, (_, i) => dayStart + i);
  const showNow = day === today && nowMin >= dayStartMin && nowMin <= dayEndMin;

  useEffect(() => {
    if (day !== today || !scroller.current) return;
    scroller.current.scrollTop = Math.max(0, (nowMin - dayStartMin) * PX_PER_MIN - 120);
    // Scroll to "now" only when the day changes, not every minute.
  }, [day, today]);

  const withUndo = (message: string, before: typeof tasks) =>
    notify(message, { label: 'Undo', run: () => useStore.setState({ tasks: before }) });

  // "tomorrow", or the day's name when the next working day is further off.
  const nextDay = relativeDay(nextWorkday(today, Boolean(settings.weekendRollover)), today);
  const nextName = nextDay === 'Tomorrow' ? 'tomorrow' : nextDay;
  const fill = () => {
    const before = useStore.getState().tasks;
    const from = day === today ? nowMin : dayStartMin;
    const { placed, left, partial, start } = autoSchedule(day, from);
    const undo = { label: 'Undo', run: () => useStore.setState({ tasks: before }) };
    // Say where it started, what only partly fits and what dropped off, and offer the obvious way out.
    const over = list.filter((t) => !t.fixed && estimateUsedUp(t));
    const part = [
      ...partial.map(partlyText),
      ...(over.length > 0
        ? [`${nameTasks(over)} ${over.length === 1 ? 'is' : 'are'} past the estimate, so not on the plan. Open ${over.length === 1 ? 'it' : 'them'} to say how much is left.`]
        : []),
    ].join(' ');
    if (left.length === 0) return notify([`Planned ${placed} task${placed === 1 ? '' : 's'} from ${fmtClock(start)}, in list order.`, part].filter(Boolean).join(' '), undo);
    notify(
      [part, `${nameTasks(left)} ${left.length === 1 ? 'does' : 'do'} not fit in the rest of today.`].filter(Boolean).join(' '),
      { label: `Move to ${nextName}`, run: () => moveToTomorrow(left.map((t) => t.id)) },
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
            {worked.map((w) => {
              const width = 100 / (layout[w.id]?.cols ?? 1);
              return (
                <div
                  key={w.id}
                  className={`block is-worked ${w.length <= 30 ? 'is-short' : ''}`}
                  style={{
                    top: (w.start - dayStartMin) * PX_PER_MIN,
                    height: w.length * PX_PER_MIN - 2,
                    left: `calc(${(layout[w.id]?.col ?? 0) * width}% + 2px)`,
                    width: `calc(${width}% - 4px)`,
                    borderLeftColor: channelColor(w.task.channelId) ?? 'var(--accent)',
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${w.task.title}, worked ${fmtClock(w.start)} to ${fmtClock(w.start + w.length)}`}
                  title="Worked on, from the timer"
                  onClick={() => useUI.getState().openTask(w.task.id)}
                  onKeyDown={(e) => e.key === 'Enter' && useUI.getState().openTask(w.task.id)}
                >
                  <span className="block-title">{w.task.title}</span>
                  <span className="block-time">
                    worked {fmtClock(w.start)} to {fmtClock(w.start + w.length)}
                  </span>
                </div>
              );
            })}
            {boxed.flatMap((t) =>
              partsOf(t).map((i) => {
                const key = `${t.id}:part${i}`;
                return (
                  <Block
                    key={key}
                    task={t}
                    part={i}
                    col={layout[key]?.col ?? 0}
                    cols={layout[key]?.cols ?? 1}
                    dayStartMin={dayStartMin}
                    dayEndMin={dayEndMin}
                  />
                );
              }),
            )}
            {heads.map((t) => (
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
