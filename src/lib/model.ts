import type { ISODate, Repeat, Task } from '../types';
import { addDays, diffDays, isWeekend } from './dates';

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
 * old day. A fixed commitment keeps its time.
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
    if (t.id === id) {
      const keepsTime = t.date === date || (t.fixed && date !== null);
      return { ...t, date, order: next, start: keepsTime ? t.start : null, fixed: date === null ? false : t.fixed };
    }
    return next === t.order ? t : { ...t, order: next };
  });
}

/**
 * Carries unfinished tasks from past days over to today. They go to the top
 * of today's list, oldest first. Fixed commitments stay on their own day: a
 * missed meeting is not something to do tomorrow. Returns the same array when
 * nothing moved.
 */
export function rollover(tasks: Task[], today: ISODate): Task[] {
  const stale = tasks
    .filter((t) => t.date !== null && t.date < today && !t.done && !t.fixed)
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
 * Plans the flexible part of a day. Unfinished tasks with no time yet, and
 * tasks whose time has already slipped past `from`, are placed in list order
 * into the gaps, starting at `from`. Fixed commitments, finished tasks and
 * timeboxes that are still ahead stay where they are.
 *
 * Returns a start for every task it handled: a number, or null when the task
 * did not fit before `until`.
 */
export function autoSchedule(day: Task[], from: number, until: number): Record<string, number | null> {
  const movable = (t: Task) => !t.done && !t.fixed && (t.start === null || t.start < from);
  const busy = day
    .filter((t) => t.start !== null && !movable(t))
    .map((t) => ({ start: t.start!, end: t.start! + (t.planned ?? DEFAULT_BLOCK) }))
    .sort((a, b) => a.start - b.start);
  const placed: Record<string, number | null> = {};
  let cursor = Math.ceil(from / 15) * 15;

  for (const task of day) {
    if (!movable(task)) continue;
    const length = task.planned ?? DEFAULT_BLOCK;
    let start = cursor;
    for (const slot of busy) {
      if (slot.end <= start) continue;
      if (slot.start >= start + length) break;
      start = Math.ceil(slot.end / 15) * 15;
    }
    if (start + length > until) {
      placed[task.id] = null;
      continue;
    }
    placed[task.id] = start;
    busy.push({ start, end: start + length });
    busy.sort((a, b) => a.start - b.start);
    // Round up to the next quarter hour, which leaves a short break after odd lengths.
    cursor = Math.ceil((start + length) / 15) * 15;
  }
  return placed;
}

/** The hours the timeline has to show so that no timebox of the day is cut off. */
export function timelineRange(day: Task[], dayStart: number, dayEnd: number): { start: number; end: number } {
  let start = dayStart;
  let end = dayEnd;
  for (const t of day) {
    if (t.start === null) continue;
    start = Math.min(start, Math.floor(t.start / 60));
    end = Math.max(end, Math.min(24, Math.ceil((t.start + (t.planned ?? DEFAULT_BLOCK)) / 60)));
  }
  return { start, end };
}

/** Whether an unfinished repeating task will come up again on `date`, a day after its current one. */
export function occursOn(task: Task, date: ISODate): boolean {
  if (!task.repeat || task.done || task.date === null || date <= task.date) return false;
  if (task.repeat === 'daily') return true;
  if (task.repeat === 'weekdays') return !isWeekend(date);
  return diffDays(date, task.repeatFrom ?? task.date) % 7 === 0;
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
