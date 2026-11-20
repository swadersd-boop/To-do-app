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
  /**
   * Length of the timebox when it differs from the estimate: replanning a
   * half-done task books only the time it still needs.
   */
  blockMin?: number | null;
  /**
   * Your answer to "how much is left?" once a task ran past its estimate: the
   * minutes still needed, as of when `atSec` seconds were tracked. The original
   * estimate stays as it was, so Insights and the recap stay honest.
   */
  left?: { min: number; atSec: number } | null;
  /** Set on a meeting that came from a calendar file: which calendar, event and occurrence it is. */
  calendarKey?: string | null;
  /** Which imported calendar the meeting came from. */
  calendarId?: string | null;
  /** Each run of the timer on this task, as epoch milliseconds: when the work actually happened. */
  sessions?: { from: number; to: number }[];
  /** Later blocks of the same task on the same day, when the plan splits it around meetings or breaks. */
  parts?: { start: number; length: number }[] | null;
  /** Seconds tracked on earlier days, before the task was carried over to this one. */
  trackedBefore?: number;
  /** The day the task was moved to the backlog by itself, after moving on too many times. */
  parkedOn?: ISODate | null;
  /** A meeting counted as passed while the app was closed: nobody confirmed it took place. */
  unconfirmed?: boolean;
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
  /** Seconds tracked this day on tasks that were then carried to a later day. */
  carriedSec?: number;
  /** Titles of the tasks this day carried over, so the day still shows what was planned. */
  carriedTitles?: string[];
  /** Work done this day on tasks that then moved on: where it sat on the timeline and for how long. */
  carriedWork?: { title: string; start: number | null; sec: number }[];
  /** All-day events from an imported calendar, such as time off or an offsite. */
  allDay?: { title: string; cal: string }[];
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
  /** After this many moves an unfinished task goes to the backlog instead. `null` never; unset means 3. */
  parkAfter?: number | null;
  /** Carry unfinished tasks over on Saturdays and Sundays too. Off: they wait for Monday. */
  weekendRollover?: boolean;
  /** Book time at the pace history shows instead of at the raw estimates. On unless switched off. */
  planAtPace?: boolean;
  /** A daily break that scheduling keeps free, in minutes from midnight. `null` start means no break. */
  lunchStart?: number | null;
  lunchLength?: number;
  /** The last calendar file imported: its name and when. */
  calendarImport?: { name: string; at: string } | null;
  /** Every calendar imported, by its id: the file it last came from and when. */
  calendarImports?: Record<string, { name: string; at: string }>;
  /** Calendar meetings deleted from the board, so importing again does not bring them back. */
  calendarHidden?: string[];
  /** When a backup was last downloaded, and the day the app last reminded you to. */
  backupAt?: string | null;
  backupNudgedOn?: string | null;
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
