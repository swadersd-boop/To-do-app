/** A calendar day as a local `YYYY-MM-DD` string. */
export type ISODate = string;

export type Repeat = 'daily' | 'weekdays' | 'weekly';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  /** The day the task is planned for. `null` means it sits in the backlog. */
  date: ISODate | null;
  /** Position within its day (or the backlog). Lower comes first. */
  order: number;
  /** Estimate in minutes. */
  planned: number | null;
  /** Time actually tracked, in seconds. */
  actualSec: number;
  channelId: string | null;
  objectiveId: string | null;
  done: boolean;
  doneAt: string | null;
  /** Timebox start, in minutes from midnight. `null` means not on the timeline. */
  start: number | null;
  subtasks: Subtask[];
  /** How many times the task has been carried over to a later day. */
  rolled: number;
  createdAt: string;
  /** Finishing a repeating task creates its next occurrence. */
  repeat?: Repeat | null;
  /** The day this occurrence was due, so a weekly task keeps its weekday after a rollover. */
  repeatFrom?: ISODate | null;
  /** The occurrence created when this one was finished, so un-finishing can take it back. */
  nextId?: string | null;
  /**
   * A fixed commitment, like a meeting. Its time is never moved by "Fill my day",
   * it does not count as work against the day's capacity, and it does not roll over.
   */
  fixed?: boolean;
  /** One of the example tasks shown on first run. */
  example?: boolean;
}

export interface Channel {
  id: string;
  name: string;
  color: string;
}

export interface Objective {
  id: string;
  /** The Monday of the week the objective belongs to. */
  weekStart: ISODate;
  title: string;
  done: boolean;
}

export interface DayLog {
  intention?: string;
  plannedAt?: string;
  shutdownAt?: string;
  reflection?: string;
  /** Unfinished tasks that were carried from this day to a later one, and their planned minutes. */
  carried?: number;
  carriedMin?: number;
}

export interface Settings {
  name: string;
  /** How much focused work fits in a day, in minutes. */
  capacityMin: number;
  /** First and last hour shown on the timeline. */
  dayStart: number;
  dayEnd: number;
  theme: 'system' | 'light' | 'dark';
  autoRollover: boolean;
}

export interface Timer {
  taskId: string;
  /** Epoch milliseconds. */
  startedAt: number;
  /** When the person last confirmed they are still working, for long-running timers. */
  checkedAt?: number;
}

/** Everything that is saved, exported and imported. */
export interface PlannerData {
  tasks: Task[];
  channels: Channel[];
  objectives: Objective[];
  days: Record<ISODate, DayLog>;
  settings: Settings;
  timer: Timer | null;
}
