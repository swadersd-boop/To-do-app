import type { ISODate, Repeat, Task } from '../types';
import { addDays, diffDays, isWeekend } from './dates';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Block length on the timeline when a task has no estimate yet. */
export const DEFAULT_BLOCK = 30;

/** How long a task's timebox is. */
export const lengthOf = (t: Task): number => t.blockMin ?? t.planned ?? DEFAULT_BLOCK;

/** The time a task still needs: its estimate minus what was already tracked, in 5-minute steps. */
export function remainingOf(t: Task): number {
  if (t.planned === null || t.actualSec < 60) return t.planned ?? DEFAULT_BLOCK;
  return Math.max(15, Math.ceil((t.planned - t.actualSec / 60) / 5) * 5);
}

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
    return moved.has(t.id)
      ? { ...t, date: today, order: next, start: null, blockMin: null, rolled: t.rolled + 1, trackedBefore: t.actualSec }
      : { ...t, order: next };
  });
}

export interface Span {
  start: number;
  end: number;
}

/**
 * Replans the rest of a day. Every unfinished flexible task is laid out again
 * from `from`, and the list order is the priority: the first task picks its
 * slot first, and whatever does not fit is what drops off, never the task you
 * put on top. A task that was partly done books only the time it still needs.
 * Fixed commitments, finished tasks and `breaks` (such as lunch) are worked
 * around and never move. `budget` caps the minutes of work placed.
 *
 * Returns a start for every flexible task: a number, or null when it did not
 * fit before `until` or within `budget`.
 */
export function autoSchedule(
  day: Task[],
  from: number,
  until: number,
  breaks: Span[] = [],
  budget = Number.POSITIVE_INFINITY,
): Record<string, number | null> {
  const busy: Span[] = [
    ...breaks,
    ...day.filter((t) => t.start !== null && (t.done || t.fixed)).map((t) => ({ start: t.start!, end: t.start! + lengthOf(t) })),
  ];
  const placed: Record<string, number | null> = {};
  const first = Math.ceil(from / 15) * 15;
  let used = 0;

  for (const task of day) {
    if (task.done || task.fixed) continue;
    const length = remainingOf(task);
    // Past the day's capacity, the rest waits for another day even if the clock has room.
    if (used + length > budget) {
      placed[task.id] = null;
      continue;
    }
    // Each task, in priority order, takes the earliest gap it fits in, so short
    // gaps before a meeting get used by a short task further down the list.
    busy.sort((a, b) => a.start - b.start);
    let start = first;
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
    used += length;
  }
  return placed;
}

/** Minutes left for flexible work between `from` and `until`, after fixed commitments and breaks. */
export function freeMinutes(day: Task[], from: number, until: number, breaks: Span[] = []): number {
  const busy = [
    ...breaks,
    ...day.filter((t) => t.start !== null && t.fixed && !t.done).map((t) => ({ start: t.start!, end: t.start! + lengthOf(t) })),
  ]
    .map((b) => ({ start: Math.max(b.start, from), end: Math.min(b.end, until) }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);
  let taken = 0;
  let edge = from;
  for (const b of busy) {
    const start = Math.max(b.start, edge);
    if (b.end > start) taken += b.end - start;
    edge = Math.max(edge, b.end);
  }
  return Math.max(0, until - from - taken);
}

/**
 * The order to work through a day: tasks with a time by their time, then the
 * rest in list order. Finished tasks and commitments that are already over
 * are left out.
 */
export function workQueue(day: Task[], now: number): Task[] {
  const ended = (t: Task) => t.fixed && t.start !== null && t.start + lengthOf(t) <= now;
  return byTime(day.filter((t) => !t.done && !ended(t)));
}

/** Tasks with a time by their time, then the rest in list order. */
export function byTime(tasks: Task[]): Task[] {
  const timed = tasks.filter((t) => t.start !== null).sort((a, b) => a.start! - b.start! || a.order - b.order);
  const loose = tasks.filter((t) => t.start === null).sort((a, b) => a.order - b.order);
  return [...timed, ...loose];
}

/**
 * What to work on now: the first task in the work queue, skipping
 * commitments that have not started yet. A meeting at 14:00 is not
 * something to focus on at 11:30.
 */
export function focusTarget(day: Task[], now: number): Task | null {
  return workQueue(day, now).find((t) => !(t.fixed && t.start !== null && t.start > now + 5)) ?? null;
}

/** The hours the timeline has to show so that no timebox of the day is cut off. */
export function timelineRange(day: Task[], dayStart: number, dayEnd: number): { start: number; end: number } {
  let start = dayStart;
  let end = dayEnd;
  for (const t of day) {
    if (t.start === null) continue;
    start = Math.min(start, Math.floor(t.start / 60));
    end = Math.max(end, Math.min(24, Math.ceil((t.start + lengthOf(t)) / 60)));
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
