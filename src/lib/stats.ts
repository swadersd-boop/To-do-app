import type { Task } from '../types';

export interface Honesty {
  /** Actual time divided by planned time. 1.3 means tasks run 30% over. */
  ratio: number;
  /** How many finished tasks the ratio is based on. */
  samples: number;
}

/** A ratio from fewer tasks than this is noise, so it is not used. */
export const MIN_SAMPLES = 3;

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
