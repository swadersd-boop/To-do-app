import type { ISODate, Repeat, Task } from '../types';
import { addDays, isWeekend } from './dates';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Block length on the timeline when a task has no estimate yet. */
export const DEFAULT_BLOCK = 30;

/** Tasks for one day (or the backlog when `date` is null), in display order. */
export function tasksOn(tasks: Task[], date: ISODate | null): Task[] {
  return tasks.filter((t) => t.date === date).sort((a, b) => a.order - b.order);
}

/**
 * Moves a task to `index` within a day or the backlog, renumbering that list.
 * A task that changes day loses its timebox, because the slot belonged to the
 * old day.
 */
export function moveTask(tasks: Task[], id: string, date: ISODate | null, index: number): Task[] {
  const task = tasks.find((t) => t.id === id);
  if (!task) return tasks;
  const dest = tasksOn(tasks, date).filter((t) => t.id !== id);
  dest.splice(clamp(index, 0, dest.length), 0, task);
  const order = new Map(dest.map((t, i) => [t.id, i]));
  return tasks.map((t) => {
    const next = order.get(t.id);
    if (next === undefined) return t;
    if (t.id === id) return { ...t, date, order: next, start: t.date === date ? t.start : null };
    return next === t.order ? t : { ...t, order: next };
  });
}

/**
 * Carries unfinished tasks from past days over to today. They go to the top
 * of today's list, oldest first. Returns the same array when nothing moved.
 */
export function rollover(tasks: Task[], today: ISODate): Task[] {
  const stale = tasks
    .filter((t) => t.date !== null && t.date < today && !t.done)
    .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : a.order - b.order));
  if (stale.length === 0) return tasks;
  const order = new Map<string, number>();
  stale.forEach((t, i) => order.set(t.id, i));
  tasksOn(tasks, today).forEach((t, i) => order.set(t.id, stale.length + i));
  const moved = new Set(stale.map((t) => t.id));
  return tasks.map((t) => {
    const next = order.get(t.id);
    if (next === undefined) return t;
    return moved.has(t.id) ? { ...t, date: today, order: next, start: null, rolled: t.rolled + 1 } : { ...t, order: next };
  });
}

/**
 * Finds a time for every unfinished task of a day that has none yet. Tasks
 * are placed in list order into the gaps between existing timeboxes, starting
 * at `from`. Anything that does not fit before `until` stays unscheduled.
 */
export function autoSchedule(day: Task[], from: number, until: number): Record<string, number> {
  const busy = day
    .filter((t) => t.start !== null)
    .map((t) => ({ start: t.start!, end: t.start! + (t.planned ?? DEFAULT_BLOCK) }))
    .sort((a, b) => a.start - b.start);
  const placed: Record<string, number> = {};
  let cursor = Math.ceil(from / 15) * 15;

  for (const task of day) {
    if (task.done || task.start !== null) continue;
    const length = task.planned ?? DEFAULT_BLOCK;
    let start = cursor;
    for (const slot of busy) {
      if (slot.end <= start) continue;
      if (slot.start >= start + length) break;
      start = Math.ceil(slot.end / 15) * 15;
    }
    if (start + length > until) continue;
    placed[task.id] = start;
    busy.push({ start, end: start + length });
    busy.sort((a, b) => a.start - b.start);
    // Round up to the next quarter hour, which leaves a short break after odd lengths.
    cursor = Math.ceil((start + length) / 15) * 15;
  }
  return placed;
}

/** Splits overlapping timeboxes into side-by-side columns. */
export function layoutBlocks(blocks: { id: string; start: number; end: number }[]): Record<string, { col: number; cols: number }> {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Record<string, { col: number; cols: number }> = {};
  let cluster: typeof sorted = [];
  let clusterEnd = -1;
  let colEnds: number[] = [];

  const flush = () => {
    for (const b of cluster) out[b.id].cols = colEnds.length;
    cluster = [];
    colEnds = [];
  };

  for (const b of sorted) {
    if (cluster.length > 0 && b.start >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= b.start);
    if (col === -1) col = colEnds.length;
    colEnds[col] = b.end;
    out[b.id] = { col, cols: 1 };
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  flush();
  return out;
}

/**
 * The next day a repeating task is due, strictly after `after`.
 * `anchor` is the day the finished occurrence was due: a weekly task stays on
 * that weekday even when it was finished late.
 */
export function nextOccurrence(repeat: Repeat, anchor: ISODate, after: ISODate): ISODate {
  if (repeat === 'weekly') {
    let next = addDays(anchor, 7);
    while (next <= after) next = addDays(next, 7);
    return next;
  }
  let next = addDays(after, 1);
  if (repeat === 'weekdays') while (isWeekend(next)) next = addDays(next, 1);
  return next;
}
