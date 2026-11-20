import type { ISODate, Repeat, Task } from '../types';
import { addDays, diffDays, isWeekend, toISO } from './dates';

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

/** The timer sessions of a task that started on `date`, as minutes from midnight. Runs under a minute are left out. */
export function sessionsOn(t: Task, date: ISODate): Span[] {
  // A hand-edited backup could hold anything here, so only well-formed runs count.
  return (Array.isArray(t.sessions) ? t.sessions : [])
    .filter((x) => x && Number.isFinite(x.from) && Number.isFinite(x.to) && toISO(new Date(x.from)) === date && x.to - x.from >= 60_000)
    .map((x) => {
      const from = new Date(x.from);
      const start = from.getHours() * 60 + from.getMinutes();
      return { start, end: start + Math.round((x.to - x.from) / 60_000) };
    });
}

/** Minutes still to do by your own numbers: what you said was left, or the estimate minus the time tracked. Null without an estimate. */
export function leftOf(t: Task): number | null {
  if (t.left) return Math.max(0, t.left.min - (t.actualSec - t.left.atSec) / 60);
  return t.planned === null ? null : Math.max(0, t.planned - t.actualSec / 60);
}

/** Worked for at least as long as the estimate (or what you said was left), and not done: it needs another look. */
export function estimateUsedUp(t: Task): boolean {
  const left = leftOf(t);
  // Less than a minute left is nothing left: a stray second must not book a quarter hour.
  return !t.done && left !== null && left < 1;
}

/** A multiplier on a task's estimate, for planning at the pace history shows. */
export type Pace = (t: Task) => number;

/** Started before `from` and worked on today: the time already spent stays where it happened. */
export function inProgress(t: Task, from: number): boolean {
  return !t.done && !t.fixed && t.start !== null && t.start < from && t.actualSec - (t.trackedBefore ?? 0) >= 60;
}

/**
 * The minutes a task still needs on the timeline: its estimate minus what was
 * tracked, at `pace`, in 5-minute steps. A task already past its estimate is
 * not planned or counted at all (see estimateUsedUp); the quarter hour here is
 * only a floor.
 */
export function needOf(t: Task, pace: Pace = () => 1): number {
  const left = leftOf(t);
  if (left === null) return DEFAULT_BLOCK;
  if (left <= 0) return 15;
  // What you said is left is already your honest guess, so pace does not scale it again.
  const scale = t.left ? 1 : pace(t);
  return Math.max(15, Math.ceil((left * scale) / 5) * 5);
}

/**
 * Tasks for one day (or the backlog when `date` is null), in display order:
 * meetings first in time order, since their place is set by the clock, then
 * the to-dos in the order you set, which is their priority.
 */
export function tasksOn(tasks: Task[], date: ISODate | null): Task[] {
  const meeting = (t: Task) => t.fixed && t.start !== null;
  return tasks
    .filter((t) => t.date === date)
    .sort((a, b) => (meeting(a) && meeting(b) ? a.start! - b.start! : meeting(a) ? -1 : meeting(b) ? 1 : a.order - b.order));
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
 * cannot pile up, except tasks `keep` protects (work for this week's objectives).
 * Returns the same array when nothing moved.
 */
export function rollover(tasks: Task[], today: ISODate, parkAfter: number | null = null, keep: (t: Task) => boolean = () => false): Task[] {
  const stale = tasks
    .filter((t) => t.date !== null && t.date < today && !t.done && !t.fixed)
    .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : a.order - b.order));
  if (stale.length === 0) return tasks;
  const parks = (t: Task) => parkAfter !== null && t.rolled >= parkAfter && !keep(t);
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
  /** Only part of what the task needs fits today; the rest stays to do. */
  partial?: boolean;
  /** For a partly booked task: the minutes it needs in all, at the plan's pace. */
  need?: number;
}

const ceil5 = (n: number) => Math.ceil(n / 5) * 5;

/**
 * Lays `need` minutes out from `from`, pausing for anything in `busy`. Tasks
 * shorter than an hour stay in one piece; longer ones may continue after an
 * interruption, in pieces of at least half an hour. Returns the pieces and
 * where the stream ends, or null when it does not fit before `until`.
 */
function flow(need: number, from: number, busy: Span[], until: number): { pieces: Span[]; end: number } | null {
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  const pieces: Span[] = [];
  let rest = need;
  let at = ceil5(from);
  while (rest > 0) {
    // Step past whatever is going on at this moment.
    for (let moved = true; moved; ) {
      moved = false;
      for (const b of sorted) {
        if (b.start <= at && at < b.end) {
          at = ceil5(b.end);
          moved = true;
        }
      }
    }
    if (at >= until) return null;
    const next = Math.min(until, ...sorted.filter((b) => b.start > at).map((b) => b.start));
    const room = next - at;
    if (room >= rest) {
      pieces.push({ start: at, end: at + rest });
      return { pieces, end: at + rest };
    }
    if (need >= 60 && room >= 30) {
      // Leave at least half an hour for after the interruption.
      const part = rest - room >= 30 ? room : Math.floor((rest - 30) / 5) * 5;
      if (part >= 30) {
        pieces.push({ start: at, end: at + part });
        rest -= part;
      }
    }
    if (next >= until) return null;
    at = next;
  }
  return { pieces, end: at };
}

/**
 * Plans the rest of a day as one stream, in list order, which is the
 * priority: each task starts where the one before it ended, from `from`.
 * Meetings, breaks and finished work interrupt the stream and it carries on
 * after them, so no task lower on the list jumps ahead of a higher one. A
 * task of an hour or more continues after an interruption; a shorter one
 * waits until it fits in one piece. Work under way keeps the block where it
 * was worked and only what it still needs is planned. When the clock
 * (`until`) or the capacity (`budget` minutes of new work) runs out, a long
 * task gets as much as still fits, at least half an hour, and everything
 * below it drops off.
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
  date?: ISODate,
): Record<string, Placement | null> {
  const first = ceil5(from);
  const out: Record<string, Placement | null> = {};
  // Time already worked is taken, wherever it happened; a finished task with sessions holds those, not its plan.
  const worked = (t: Task) => (date ? sessionsOn(t, date) : []);
  const busy: Span[] = [
    ...breaks,
    ...day.flatMap(worked),
    ...day.filter((t) => t.fixed || (t.done && worked(t).length === 0)).flatMap(blocksOf),
  ];
  // Without sessions to show where it happened, the part already worked keeps its planned place.
  for (const t of day.filter((x) => inProgress(x, first) && worked(x).length === 0)) {
    const record = { start: t.start!, end: Math.min(t.start! + lengthOf(t), first) };
    busy.push(record);
    out[t.id] = { blocks: [record] };
  }
  let cursor = first;
  let used = 0;
  // Once something does not fit, the rest of the list drops off: nothing lower jumps ahead of it.
  let full = false;
  for (const t of day) {
    if (t.done || t.fixed) continue;
    const record = out[t.id]?.blocks ?? [];
    // Past its estimate, nobody knows what is left: book nothing rather than guess, and go on with the rest.
    if (estimateUsedUp(t)) {
      out[t.id] = record.length > 0 ? { blocks: record } : null;
      continue;
    }
    const need = needOf(t, pace);
    let placed = full ? null : used + need <= budget ? flow(need, cursor, busy, until) : null;
    let partial = false;
    if (!placed && !full && need >= 60) {
      // A long task gets as much as still fits, at least half an hour, rather than nothing.
      for (let amount = Math.floor(Math.min(need - 5, budget - used) / 5) * 5; amount >= 30 && !placed; amount -= 5) {
        placed = flow(amount, cursor, busy, until);
      }
      partial = placed !== null;
    }
    if (!placed) {
      full = true;
      out[t.id] = record.length > 0 ? { blocks: record } : null;
      continue;
    }
    if (partial) full = true;
    busy.push(...placed.pieces);
    used += need;
    cursor = placed.end;
    // Work that carries straight on from where it stands is one block, not two.
    const last = record[record.length - 1];
    const joined = last && placed.pieces[0].start === last.end;
    out[t.id] = {
      blocks: joined ? [...record.slice(0, -1), { start: last.start, end: placed.pieces[0].end }, ...placed.pieces.slice(1)] : [...record, ...placed.pieces],
      ...(partial ? { partial: true, need } : {}),
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
  date?: ISODate,
): Record<string, number | null> {
  const plan = planDay(day, from, until, breaks, budget, pace, date);
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
  // A task is placed by its next block that is not over yet; one with only past blocks counts as unscheduled.
  const nextStart = (t: Task) => blocksOf(t).find((b) => b.end > now)?.start ?? null;
  const open = day.filter((t) => !t.done && !ended(t));
  // Work whose planned time has passed without it being done is behind, so it comes first.
  const behind = open.filter((t) => !t.fixed && nextStart(t) === null && blocksOf(t).length > 0).sort((a, b) => a.order - b.order);
  const timed = open.filter((t) => nextStart(t) !== null).sort((a, b) => nextStart(a)! - nextStart(b)! || a.order - b.order);
  const loose = open.filter((t) => nextStart(t) === null && !behind.includes(t)).sort((a, b) => a.order - b.order);
  return [...behind, ...timed, ...loose];
}

/** Tasks with a time by their time, then the rest in list order. */
export function byTime(tasks: Task[]): Task[] {
  const timed = tasks.filter((t) => t.start !== null).sort((a, b) => a.start! - b.start! || a.order - b.order);
  const loose = tasks.filter((t) => t.start === null).sort((a, b) => a.order - b.order);
  return [...timed, ...loose];
}

/** What to work on now: the first task in the work queue that is not a meeting. */
export function focusTarget(day: Task[], now: number): Task | null {
  return workQueue(day, now).find((t) => !t.fixed) ?? null;
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
