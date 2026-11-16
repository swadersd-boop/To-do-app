import { useEffect, useMemo, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Pin, Wand2, X } from 'lucide-react';
import type { Task } from '../types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { DEFAULT_BLOCK, layoutBlocks, tasksOn, timelineRange } from '../lib/model';
import { relativeDay, shortDate } from '../lib/dates';
import { fmtClock, snap } from '../lib/time';
import { useNow } from './bits';

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

  const start = gesture?.start ?? task.start!;
  const length = gesture?.length ?? task.planned ?? DEFAULT_BLOCK;

  const begin = (mode: Gesture['mode']) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setGesture({ id: task.id, mode, originY: e.clientY, start: task.start!, length: task.planned ?? DEFAULT_BLOCK, moved: false });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!gesture) return;
    const dy = (e.clientY - gesture.originY) / PX_PER_MIN;
    if (!gesture.moved && Math.abs(dy) < 4) return;
    if (gesture.mode === 'move') {
      const base = task.start!;
      const next = Math.min(dayEndMin - STEP, Math.max(dayStartMin, snap(base + dy, STEP)));
      setGesture({ ...gesture, start: next, moved: true });
    } else {
      const base = task.planned ?? DEFAULT_BLOCK;
      setGesture({ ...gesture, length: Math.max(STEP, snap(base + dy, STEP)), moved: true });
    }
  };

  const onUp = () => {
    if (!gesture) return;
    if (!gesture.moved) {
      if (gesture.mode === 'move') openTask(task.id);
    } else if (gesture.mode === 'move') updateTask(task.id, { start: gesture.start });
    else updateTask(task.id, { planned: gesture.length });
    setGesture(null);
  };

  const width = 100 / cols;
  return (
    <div
      className={`block ${task.fixed ? 'is-fixed' : ''} ${task.done ? 'is-done' : ''} ${gesture?.moved ? 'is-moving' : ''} ${length <= 30 ? 'is-short' : ''} ${length <= 15 ? 'is-tiny' : ''}`}
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
      onPointerCancel={() => setGesture(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') openTask(task.id);
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const delta = e.key === 'ArrowUp' ? -STEP : STEP;
          if (e.shiftKey) updateTask(task.id, { planned: Math.max(STEP, (task.planned ?? DEFAULT_BLOCK) + delta) });
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
  const layout = useMemo(
    () => layoutBlocks(boxed.map((t) => ({ id: t.id, start: t.start!, end: t.start! + Math.max(STEP, t.planned ?? DEFAULT_BLOCK) }))),
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
    const { placed, left } = autoSchedule(day, day === today ? nowMin : dayStartMin);
    if (placed === 0 && left === 0) return notify('Everything already has a time.');
    const until = `${fmtClock(settings.dayEnd * 60)}`;
    if (placed === 0) return withUndo(`Nothing fits before ${until}. ${left} task${left === 1 ? ' has' : 's have'} no time.`, before);
    withUndo(
      left === 0
        ? `Gave ${placed} task${placed === 1 ? '' : 's'} a time`
        : `Gave ${placed} task${placed === 1 ? '' : 's'} a time. ${left} did not fit before ${until}.`,
      before,
    );
  };

  const clear = () => {
    const before = useStore.getState().tasks;
    clearSchedule(day);
    withUndo('Cleared the planned times. Fixed ones stay.', before);
  };

  const flexibleBoxed = boxed.some((t) => !t.done && !t.fixed);
  const canFill = list.some((t) => !t.done && !t.fixed && (t.start === null || (day === today && t.start < nowMin)));

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
            title="Give a time to every task without one, and to tasks whose time has passed. Fixed times do not move."
          >
            <Wand2 size={14} />
            Fill my day
          </button>
        </div>
      </header>

      <div className="timeline-scroll" ref={scroller}>
        <div
          ref={setNodeRef}
          className={`grid ${isOver ? 'is-over' : ''}`}
          data-timeline-grid
          data-day-start={dayStartMin}
          style={{ height: (dayEndMin - dayStartMin) * PX_PER_MIN }}
        >
          {hours.map((h) => (
            <div key={h} className="hour" style={{ top: (h * 60 - dayStartMin) * PX_PER_MIN, height: 60 * PX_PER_MIN }}>
              <span className="hour-label">{fmtClock(h * 60)}</span>
            </div>
          ))}
          <div className="grid-lane">
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
