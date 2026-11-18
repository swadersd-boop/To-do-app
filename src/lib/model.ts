import type { ISODate, Repeat, Task } from '../types';
import { addDays, diffDays, isWeekend } from './dates';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Block length on the timeline when a task has no estimate yet. */
export const DEFAULT_BLOCK = 30;

/** How long a task's timebox is. */
export const lengthOf = (t: Task): number => t.blockMin ?? t.planned ?? DEFAULT_BLOCK;

/** Every block a task has on its day: the first, then any later parts, in time order. */
export function blocksOf(t: Task): Span[] {
  if (t.start === null) return [];
  return [{ start: t.start, end: t.start + lengthOf(t) }, ...(t.parts ?? []).map((p) => ({ start: p.start, end: p.start + p.length }))];
}

/** Worked for at least as long as the estimate, and not done: the estimate needs another look. */
export function estimateUsedUp(t: Task): boolean {
  return !t.done && t.planned !== null && t.actualSec / 60 >= t.planned;
}

/** A multiplier on a task's estimate, for planning at the pace history shows. */
export type Pace = (t: Task) => number;

/** Started before `from` and worked on today: the time already spent stays where it happened. */
export function inProgress(t: Task, from: number): boolean {
  return !t.done && !t.fixed && t.start !== null && t.start < from && t.actualSec - (t.trackedBefore ?? 0) >= 60;
}

/**
 * The minutes a task still needs on the timeline: its estimate minus what was
 * tracked, at `pace`, in 5-minute steps. A task already past its estimate gets
 * a plain quarter hour; the plan asks for a new estimate instead of guessing.
 */
export function needOf(t: Task, pace: Pace = () => 1): number {
  if (t.planned === null) return DEFAULT_BLOCK;
  const left = t.planned - t.actualSec / 60;
  if (left <= 0) return 15;
  return Math.max(15, Math.ceil((left * pace(t)) / 5) * 5);
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
      return { ...t, date, order: next, start: keepsTime ? t.start : null, parts: t.date === date ? t.parts : null, fixed: date === null ? false : t.fixed };
    }
    return next === t.order ? t : { ...t, order: next };
  });
}

/**
 * Carries unfinished tasks from past days over to today, after whatever is
 * already planned for today, oldest first. Fixed commitments stay on their own
 * day: a missed meeting is not something to do tomorrow. A task that has
 * already moved on `parkAfter` times goes to the backlog instead, so stale work
 * cannot pile up. Returns the same array when nothing moved.
 */
export function rollover(tasks: Task[], today: ISODate, parkAfter: number | null = null): Task[] {
  const stale = tasks
    .filter((t) => t.date !== null && t.date < today && !t.done && !t.fixed)
    .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : a.order - b.order));
  if (stale.length === 0) return tasks;
  const parks = (t: Task) => parkAfter !== null && t.rolled >= parkAfter;
  const toToday = stale.filter((t) => !parks(t));
  const toBacklog = stale.filter(parks);
  const onToday = tasksOn(tasks, today).length;
  const inBacklog = tasksOn(tasks, null).length;
  const order = new Map<string, number>();
  toToday.forEach((t, i) => order.set(t.id, onToday + i));
  toBacklog.forEach((t, i) => order.set(t.id, inBacklog + i));
  return tasks.map((t) => {
    const next = order.get(t.id);
    if (next === undefined) return t;
    const moved = { ...t, order: next, start: null, blockMin: null, parts: null, rolled: t.rolled + 1, trackedBefore: t.actualSec };
    return parks(t) ? { ...moved, date: null, parkedOn: today } : { ...moved, date: today };
  });
}

export interface Span {
  start: number;
  end: number;
}

export interface Placement {
  /** The blocks a task gets, in time order. A long task can be split around meetings and breaks. */
  blocks: Span[];
}

/** Free stretches between `from` and `until` around `busy`. Each starts on a quarter hour. */
function gapsAround(busy: Span[], from: number, until: number): Span[] {
  const gaps: Span[] = [];
  let cursor = from;
  for (const slot of [...busy].sort((a, b) => a.start - b.start)) {
    if (slot.end <= cursor) continue;
    if (slot.start > cursor) gaps.push({ start: cursor, end: Math.min(slot.start, until) });
    cursor = Math.max(cursor, Math.ceil(slot.end / 15) * 15);
    if (cursor >= until) break;
  }
  if (cursor < until) gaps.push({ start: cursor, end: until });
  return gaps.filter((g) => g.end > g.start);
}

/** Where `need` minutes go: whole in the first gap that holds them, or for long work split over up to three gaps. */
function fit(need: number, gaps: Span[]): Span[] | null {
  if (need < 60) {
    const gap = gaps.find((g) => g.end - g.start >= need);
    return gap ? [{ start: gap.start, end: gap.start + need }] : null;
  }
  const pieces: Span[] = [];
  let rest = need;
  for (const g of gaps) {
    const room = Math.floor((g.end - g.start) / 5) * 5;
    if (room >= rest) {
      pieces.push({ start: g.start, end: g.start + rest });
      return pieces;
    }
    // Only the last piece may be shorter than the gap; every piece is at least half an hour.
    if (pieces.length < 2 && room >= 30) {
      const part = rest - room >= 30 ? room : Math.floor((rest - 30) / 5) * 5;
      if (part >= 30) {
        pieces.push({ start: g.start, end: g.start + part });
        rest -= part;
      }
    }
  }
  return null;
}

/**
 * Plans the rest of a day. Unfinished flexible tasks are placed in list order,
 * which is the priority: each takes the earliest free time from `from`, and a
 * task of an hour or more continues after a meeting or break in up to three
 * blocks rather than waiting for one gap long enough for all of it. Work under
 * way keeps the block where it was worked, and only what it still needs is
 * planned. Fixed commitments, finished work and `breaks` never move. `budget`
 * caps the minutes of new work placed.
 *
 * Returns the blocks for every flexible task, or null when it did not fit.
 */
export function planDay(
  day: Task[],
  from: number,
  until: number,
  breaks: Span[] = [],
  budget = Number.POSITIVE_INFINITY,
  pace: Pace = () => 1,
): Record<string, Placement | null> {
  const first = Math.ceil(from / 15) * 15;
  const out: Record<string, Placement | null> = {};
  const busy: Span[] = [...breaks, ...day.filter((t) => t.done || t.fixed).flatMap(blocksOf)];
  // The part already worked stays as a record of where it happened.
  for (const t of day.filter((x) => inProgress(x, first))) {
    const record = { start: t.start!, end: Math.min(t.start! + lengthOf(t), first) };
    busy.push(record);
    out[t.id] = { blocks: [record] };
  }
  let used = 0;
  for (const t of day) {
    if (t.done || t.fixed) continue;
    const record = out[t.id]?.blocks ?? [];
    const need = needOf(t, pace);
    const pieces = used + need <= budget ? fit(need, gapsAround(busy, first, until)) : null;
    if (!pieces) {
      out[t.id] = record.length > 0 ? { blocks: record } : null;
      continue;
    }
    busy.push(...pieces);
    used += need;
    // Work that carries straight on from where it stands is one block, not two.
    const joined = record.length > 0 && pieces[0].start === record[record.length - 1].end;
    out[t.id] = {
      blocks: joined ? [...record.slice(0, -1), { start: record[record.length - 1].start, end: pieces[0].end }, ...pieces.slice(1)] : [...record, ...pieces],
    };
  }
  return out;
}

/** The start of each flexible task's first block, or null when it did not fit. */
export function autoSchedule(
  day: Task[],
  from: number,
  until: number,
  breaks: Span[] = [],
  budget = Number.POSITIVE_INFINITY,
  pace: Pace = () => 1,
): Record<string, number | null> {
  const plan = planDay(day, from, until, breaks, budget, pace);
  return Object.fromEntries(Object.entries(plan).map(([id, p]) => [id, p ? p.blocks[0].start : null]));
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
  for (const b of day.flatMap(blocksOf)) {
    start = Math.min(start, Math.floor(b.start / 60));
    end = Math.max(end, Math.min(24, Math.ceil(b.end / 60)));
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
