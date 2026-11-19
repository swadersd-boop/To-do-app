import { addDays, isWeekend } from './dates';
import { blocksOf, estimateUsedUp, needOf } from './model';
import type { Task } from '../types';

export interface Honesty {
  /** Actual time divided by planned time. 1.3 means tasks run 30% over. */
  ratio: number;
  /** How many finished tasks the ratio is based on. */
  samples: number;
}

/** A ratio from fewer tasks than this is noise, so it is not used. */
export const MIN_SAMPLES = 5;

function measurable(t: Task): boolean {
  return t.done && (t.planned ?? 0) > 0 && t.actualSec >= 60;
}

function ratioOf(tasks: Task[]): Honesty | null {
  const sample = tasks.filter(measurable);
  if (sample.length < MIN_SAMPLES) return null;
  const planned = sample.reduce((sum, t) => sum + (t.planned ?? 0), 0);
  const actual = sample.reduce((sum, t) => sum + t.actualSec / 60, 0);
  return { ratio: actual / planned, samples: sample.length };
}

/** How honest the estimates have been, overall and per channel. */
export function honesty(tasks: Task[]): { overall: Honesty | null; byChannel: Record<string, Honesty> } {
  const byChannel: Record<string, Honesty> = {};
  const ids = new Set(tasks.map((t) => t.channelId).filter((id): id is string => id !== null));
  for (const id of ids) {
    const h = ratioOf(tasks.filter((t) => t.channelId === id));
    if (h) byChannel[id] = h;
  }
  return { overall: ratioOf(tasks), byChannel };
}

/**
 * What a list of tasks will probably take, given past estimates. Each task is
 * scaled by its channel's ratio, falling back to the overall one. Returns null
 * when there is not enough history to say anything.
 */
export function forecast(plan: Task[], history: Task[]): number | null {
  const h = honesty(history);
  if (!h.overall) return null;
  return plan.reduce((sum, t) => {
    const ratio = (t.channelId && h.byChannel[t.channelId]?.ratio) || h.overall!.ratio;
    return sum + (t.planned ?? 0) * ratio;
  }, 0);
}

export const plannedTotal = (tasks: Task[]) => tasks.reduce((sum, t) => sum + (t.planned ?? 0), 0);
/** Planned minutes of flexible work, which is what counts against the day's capacity. */
export const workTotal = (tasks: Task[]) => plannedTotal(tasks.filter((t) => !t.fixed));
/** Planned minutes taken by fixed commitments such as meetings. */
export const fixedTotal = (tasks: Task[]) => plannedTotal(tasks.filter((t) => t.fixed));
export const actualTotal = (tasks: Task[]) => tasks.reduce((sum, t) => sum + t.actualSec / 60, 0);

/** Seconds of a task tracked on its current day, leaving out days it was carried from. */
export const todaySec = (t: Task) => Math.max(0, t.actualSec - (t.trackedBefore ?? 0));


/** To-dos only: meetings and other fixed commitments are not counted as work done or left. */
export const todos = (tasks: Task[]) => tasks.filter((t) => !t.fixed);

export interface WeekSummary {
  /** The Monday the week starts on. */
  start: string;
  done: number;
  /** Minutes tracked across the week. */
  tracked: number;
  /** To-dos still open when the week ended, as handed on by its last active day. */
  leftOver: number;
  objectivesDone: number;
  objectives: number;
}

/** What a calendar week came to. Each task counts once, on the day it was finished. */
export function weekSummary(
  tasks: Task[],
  days: Record<string, { carried?: number; carriedSec?: number; carriedTitles?: string[] }>,
  objectives: { weekStart: string; done: boolean }[],
  start: string,
): WeekSummary {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const inWeek = tasks.filter((t) => t.date !== null && dates.includes(t.date));
  // What was still open when the working week ended: from its last working day with leftovers to the end
  // of the week, each task once (a task carried Friday and again Saturday is one task).
  const carriedFrom = (d: string) => days[d] && (days[d].carried ?? 0) > 0;
  const lastWork = [...dates].reverse().find((d) => !isWeekend(d) && carriedFrom(d)) ?? [...dates].reverse().find(carriedFrom);
  const tail = lastWork ? dates.filter((d) => d >= lastWork && carriedFrom(d)) : [];
  const titles = tail.flatMap((d) => days[d].carriedTitles ?? []);
  const leftOver = tail.every((d) => days[d].carriedTitles) ? new Set(titles).size : tail.reduce((sum, d) => sum + (days[d].carried ?? 0), 0);
  const objs = objectives.filter((o) => o.weekStart === start);
  return {
    start,
    done: inWeek.filter((t) => t.done && !t.fixed).length,
    tracked: dates.reduce((sum, d) => sum + workDone(inWeek.filter((t) => t.date === d), days[d]), 0),
    leftOver,
    objectivesDone: objs.filter((o) => o.done).length,
    objectives: objs.length,
  };
}

/**
 * How much longer than estimated tasks really take, as a multiplier per task,
 * from finished history: the task's channel if it has enough data, otherwise
 * all tasks. Kept between 0.5 and 2 so one odd week cannot wreck a plan.
 * Null when there is not enough history.
 */
export function paceOf(history: Task[]): ((t: Task) => number) | null {
  const h = honesty(history);
  if (!h.overall) return null;
  const clampPace = (r: number) => Math.min(2, Math.max(0.5, r));
  return (t: Task) => clampPace((t.channelId && h.byChannel[t.channelId]?.ratio) || h.overall!.ratio);
}

/**
 * Minutes worked on one to-do on its day: the time tracked, or, for a task
 * finished without the timer, the block it kept on the timeline (it shrinks
 * to the time taken when finished partway), else what was left of its estimate.
 */
export function workedMin(t: Task): number {
  if (t.fixed) return 0;
  const tracked = todaySec(t) / 60;
  if (tracked >= 1) return tracked;
  if (!t.done) return 0;
  if (t.start !== null) return blocksOf(t).reduce((sum, b) => sum + b.end - b.start, 0);
  return Math.max(0, (t.planned ?? 0) - (t.trackedBefore ?? 0) / 60);
}

/**
 * Minutes of work done on a day's to-dos, as workedMin counts them. This is
 * the one measure of a day's work: the column, the shutdown, the recap,
 * Insights and the weekly review all use it.
 * Meetings are not counted. Pass the day's log to include time worked there
 * on tasks that have since moved to another day.
 */
export function workDone(day: Task[], log?: { carriedSec?: number }): number {
  return (log?.carriedSec ?? 0) / 60 + day.reduce((sum, t) => sum + workedMin(t), 0);
}

/** Minutes the open to-dos of a day still need, measured as the plan measures them. */
export function workLeft(day: Task[], pace?: (t: Task) => number): number {
  // A task past its estimate adds nothing until someone says how much is left.
  return day.filter((t) => !t.fixed && !t.done && !estimateUsedUp(t)).reduce((sum, t) => sum + needOf(t, pace), 0);
}
