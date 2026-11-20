import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Channel, DayLog, ISODate, Objective, PlannerData, Settings, Subtask, Task } from './types';
import { addDays, isWeekend, toISO, todayISO, weekStart } from './lib/dates';
import { paceOf, workDone } from './lib/stats';
import type { CalendarRead, Meeting } from './lib/ics';
import { DEFAULT_BLOCK, estimateUsedUp, lengthOf, moveTask, nextOccurrence, planDay, rollover, sessionsOn, tasksOn, type Pace, type Span } from './lib/model';

export const STORAGE_KEY = 'kalm:v1';

export const CHANNEL_COLORS = ['#4f8a6b', '#d99a2b', '#c8623f', '#8a5a9e', '#3d8fa8', '#c9587a', '#6b7a8f', '#8a8f3a'];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  capacityMin: 360,
  dayStart: 8,
  dayEnd: 19,
  theme: 'system',
  autoRollover: true,
  lunchStart: 12 * 60,
  lunchLength: 60,
};

/** The breaks scheduling keeps free. */
export function breaksOf(settings: Settings): Span[] {
  if (settings.lunchStart === null || settings.lunchStart === undefined) return [];
  return [{ start: settings.lunchStart, end: settings.lunchStart + (settings.lunchLength ?? 60) }];
}

export interface NewTask {
  title: string;
  date: ISODate | null;
  planned?: number | null;
  channelId?: string | null;
  start?: number | null;
  notes?: string;
  fixed?: boolean;
  example?: boolean;
}

function makeTask(input: NewTask, order: number): Task {
  return {
    id: uid(),
    title: input.title.trim(),
    notes: input.notes ?? '',
    date: input.date,
    order,
    planned: input.planned ?? null,
    actualSec: 0,
    channelId: input.channelId ?? null,
    objectiveId: null,
    done: false,
    doneAt: null,
    start: input.date === null ? null : (input.start ?? null),
    subtasks: [],
    rolled: 0,
    createdAt: new Date().toISOString(),
    fixed: input.date !== null && Boolean(input.fixed),
    example: input.example,
  };
}

const STARTER_CHANNELS = ['work', 'deep', 'admin', 'personal'];

/** A few example tasks so the first screen shows how things work. */
export function seed(today: ISODate): PlannerData {
  const channels: Channel[] = [
    { id: 'work', name: 'work', color: CHANNEL_COLORS[0] },
    { id: 'deep', name: 'deep-work', color: CHANNEL_COLORS[4] },
    { id: 'admin', name: 'admin', color: CHANNEL_COLORS[1] },
    { id: 'personal', name: 'personal', color: CHANNEL_COLORS[3] },
  ];
  const tomorrow = addDays(today, 1);
  const starter: NewTask[] = [
    { title: 'Press "Plan today" and walk through the ritual', date: today, planned: 10, channelId: 'admin' },
    { title: 'Give this card a time: drag it onto the timeline, or open it and set a start', date: today, planned: 45, channelId: 'deep' },
    { title: 'Press play on a card to focus on it', date: today, planned: 25, channelId: 'work' },
    { title: 'Move me to another day: drag me, or open me and pick a day', date: today, planned: 15, channelId: 'personal' },
    { title: 'Type "Call the dentist 15m #personal" in the box above', date: tomorrow, planned: 5, channelId: 'admin' },
    { title: 'Things without a day live here until you pull them in', date: null, planned: 30, channelId: null },
  ];
  const counts = new Map<string, number>();
  const tasks = starter.map((t) => {
    const key = String(t.date);
    const order = counts.get(key) ?? 0;
    counts.set(key, order + 1);
    return makeTask({ ...t, example: true }, order);
  });
  const objectives: Objective[] = [
    { id: uid(), weekStart: weekStart(today), title: 'Finish every day with a shutdown', done: false },
  ];
  return { tasks, channels, objectives, days: {}, settings: DEFAULT_SETTINGS, timer: null };
}

interface Actions {
  addTask: (input: NewTask, atTop?: boolean) => string;
  updateTask: (id: string, patch: Partial<Omit<Task, 'id'>>) => void;
  /** Records how many minutes a task still needs, keeping its original estimate. */
  setLeft: (id: string, min: number) => void;
  deleteTask: (id: string) => Task | null;
  restoreTask: (task: Task) => void;
  toggleDone: (id: string) => void;
  /** Marks fixed commitments that are over as done, and creates the next one of a repeating commitment. */
  settleCommitments: (today: ISODate, nowMin: number) => void;
  moveTask: (id: string, date: ISODate | null, index: number) => void;
  /** Moves a task to the end of a day or the backlog. */
  sendTo: (id: string, date: ISODate | null) => void;
  /** Takes a task out of the backlog onto a day, starting its moved-on count again. */
  bringBack: (id: string, date: ISODate) => void;
  /**
   * Puts an unfinished task off to a later day. Counts as moving on, like an
   * overnight carry-over, and parks it in the backlog past the same limit.
   * Returns where it went.
   */
  defer: (id: string, date: ISODate, options?: { counts?: boolean }) => 'day' | 'backlog';
  rollover: (today: ISODate) => void;
  /** Replans the flexible tasks of a day. Returns how many got a time, which did not fit, which only partly fit, and where it started. */
  autoSchedule: (date: ISODate, from: number, pace?: Pace) => { placed: number; left: Task[]; partial: { task: Task; minutes: number; need: number }[]; start: number };
  clearSchedule: (date: ISODate) => void;
  removeExamples: () => void;
  /**
   * Brings meetings from a calendar file onto the board for days `from` to
   * `to`: new ones are added, changed ones updated, and ones that are gone from
   * the calendar removed (unless they were worked on or finished).
   */
  importCalendar: (
    read: CalendarRead,
    from: ISODate,
    to: ISODate,
    cal: string,
    name: string,
  ) => { added: number; updated: number; removed: number; replaced: string[] };

  addSubtask: (taskId: string, title: string) => void;
  updateSubtask: (taskId: string, subId: string, patch: Partial<Subtask>) => void;
  deleteSubtask: (taskId: string, subId: string) => void;

  startTimer: (id: string) => void;
  /** Stops the timer. Pass `endAt` to count only the time up to that moment. */
  stopTimer: (endAt?: number) => void;
  /** Records that the person is still working, which quiets the long-timer prompt. */
  confirmTimer: () => void;

  /** Finds a channel by name, or creates it. Returns its id. */
  channelByName: (name: string) => string;
  updateChannel: (id: string, patch: Partial<Omit<Channel, 'id'>>) => void;
  deleteChannel: (id: string) => void;

  addObjective: (title: string, week: ISODate) => void;
  updateObjective: (id: string, patch: Partial<Omit<Objective, 'id'>>) => void;
  /** Removes an objective and unlinks its tasks. Returns what is needed to undo it. */
  deleteObjective: (id: string) => { objective: Objective; linked: string[] } | null;
  restoreObjective: (objective: Objective, linked: string[]) => void;

  setDay: (date: ISODate, patch: DayLog) => void;
  setSettings: (patch: Partial<Settings>) => void;
  importData: (data: PlannerData) => void;
  reset: () => void;
}

export type Store = PlannerData & Actions;

const nextOrder = (tasks: Task[], date: ISODate | null) =>
  tasks.reduce((max, t) => (t.date === date ? Math.max(max, t.order + 1) : max), 0);

const slug = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');

/** Work for an open objective of this week is never parked out of sight: the week depends on it. */
function servesObjective(s: PlannerData, today: ISODate): (t: Task) => boolean {
  const open = new Set(s.objectives.filter((o) => !o.done && o.weekStart === weekStart(today)).map((o) => o.id));
  return (t) => t.objectiveId != null && open.has(t.objectiveId);
}

/** No single sitting is longer than this. A timer left on overnight stops counting here. */
export const MAX_SESSION_SEC = 8 * 3600;

/**
 * Adds the running timer's elapsed time to its task. A run that started on an
 * earlier day than the task is now on (a timer left on overnight, or work on a
 * task that has since moved) is booked to the day it started.
 */
function settleTimer(state: PlannerData, endAt?: number): Pick<PlannerData, 'tasks' | 'timer' | 'days'> {
  if (!state.timer) return { tasks: state.tasks, timer: null, days: state.days };
  const { taskId, startedAt } = state.timer;
  const now = endAt ?? overnightEnd(startedAt, Date.now(), state.settings.dayEnd);
  const elapsed = Math.min(MAX_SESSION_SEC, Math.max(0, Math.round((now - startedAt) / 1000)));
  // Keep when the work happened, not only how long it took.
  const session = { from: startedAt, to: startedAt + elapsed * 1000 };
  const task = state.tasks.find((t) => t.id === taskId);
  const startDay = toISO(new Date(startedAt));
  const elsewhere = Boolean(task) && task!.date !== startDay && elapsed > 0;
  let days = state.days;
  if (elsewhere) {
    const log = days[startDay] ?? {};
    const from = new Date(startedAt);
    days = {
      ...days,
      [startDay]: {
        ...log,
        carriedSec: (log.carriedSec ?? 0) + elapsed,
        carriedWork: elapsed >= 60 ? [...(log.carriedWork ?? []), { title: task!.title, start: from.getHours() * 60 + from.getMinutes(), sec: elapsed }] : log.carriedWork,
      },
    };
  }
  return {
    tasks: state.tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            actualSec: t.actualSec + elapsed,
            sessions: elapsed >= 60 ? [...(t.sessions ?? []), session] : t.sessions,
            ...(elsewhere ? { trackedBefore: (t.trackedBefore ?? 0) + elapsed } : {}),
          }
        : t,
    ),
    timer: null,
    days,
  };
}

/**
 * Where a timer stopped without a given time ends. Within its own day, now. A
 * timer that ran into the next day is never charged for the night: it ends at
 * the end of the working day it started on, or books nothing if it was started
 * after that. The timer question asks for the real time before it gets here.
 */
export function overnightEnd(startedAt: number, now: number, dayEnd: number): number {
  if (toISO(new Date(startedAt)) === toISO(new Date(now))) return now;
  const end = new Date(startedAt);
  end.setHours(dayEnd, 0, 0, 0);
  return Math.min(now, Math.max(startedAt, end.getTime()));
}

/**
 * When tasks leave a day, the time worked on them there stays in that day's
 * record, and they start the new day with nothing tracked on it yet. Tasks
 * for which `movedOn` is true are also listed as having moved on.
 */
export function keepWorkOnDay(
  before: Task[],
  after: Task[],
  days: Record<ISODate, DayLog>,
  movedOn: (t: Task) => boolean = () => false,
): { tasks: Task[]; days: Record<ISODate, DayLog> } {
  const was = new Map(before.map((t) => [t.id, t]));
  let out = days;
  const tasks = after.map((t) => {
    const old = was.get(t.id);
    if (!old || t.date === old.date) return t;
    // A timebox belongs to the day it was made for.
    const cleared = t.fixed ? t : { ...t, blockMin: null, parts: null };
    if (!old.date) return cleared;
    const workedSec = Math.max(0, old.actualSec - (old.trackedBefore ?? 0));
    const counted = movedOn(old);
    if (workedSec < 1 && !counted) return cleared;
    const log = out[old.date] ?? {};
    out = {
      ...out,
      [old.date]: {
        ...log,
        ...(counted
          ? { carried: (log.carried ?? 0) + 1, carriedMin: (log.carriedMin ?? 0) + (old.planned ?? 0), carriedTitles: [...(log.carriedTitles ?? []), old.title] }
          : {}),
        carriedSec: (log.carriedSec ?? 0) + workedSec,
        carriedWork: workedSec >= 60 ? [...(log.carriedWork ?? []), { title: old.title, start: old.start, sec: workedSec }] : log.carriedWork,
      },
    };
    return { ...cleared, trackedBefore: t.actualSec };
  });
  return { tasks, days: out };
}

/**
 * Marks a task done. A repeating task gets its next occurrence: the first due
 * day after the one it was due on, and never earlier than today, so a missed
 * week does not come back as five copies.
 */
function complete(tasks: Task[], task: Task, today: ISODate): Task[] {
  const { tasks: out, nextId } = task.repeat ? spawnNext(tasks, task, today) : { tasks, nextId: null };
  return out.map((t) => (t.id === task.id ? { ...t, done: true, doneAt: new Date().toISOString(), nextId } : t));
}

/**
 * Creates the next occurrence of a repeating task. A series never has two
 * open occurrences: if one is already waiting, that one is the next.
 */
function spawnNext(tasks: Task[], task: Task, today: ISODate): { tasks: Task[]; nextId: string | null } {
  if (!task.repeat) return { tasks, nextId: null };
  const due = task.date ?? today;
  const yesterday = addDays(today, -1);
  const date = nextOccurrence(task.repeat, task.repeatFrom ?? due, due > yesterday ? due : yesterday);
  const waiting = tasks.find(
    (t) => t.id !== task.id && !t.done && t.repeat === task.repeat && t.title === task.title && t.date !== null && t.date >= date,
  );
  if (waiting) return { tasks, nextId: waiting.id };
  // Only a fixed commitment keeps its hour. A time picked by "Fill my day" was for that day alone.
  const input: NewTask = {
    title: task.title,
    date,
    planned: task.planned,
    channelId: task.channelId,
    notes: task.notes,
    start: task.fixed ? task.start : null,
    fixed: task.fixed,
  };
  const next: Task = {
    ...makeTask(input, nextOrder(tasks, date)),
    subtasks: task.subtasks.map((x) => ({ ...x, id: uid(), done: false })),
    repeat: task.repeat,
    repeatFrom: date,
  };
  return { tasks: [...tasks, next], nextId: next.id };
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...seed(todayISO()),

      addTask: (input, atTop = false) => {
        const task = makeTask(input, nextOrder(get().tasks, input.date));
        set((s) => {
          const tasks = [...s.tasks, task];
          return { tasks: atTop ? moveTask(tasks, task.id, task.date, 0) : tasks };
        });
        return task.id;
      },

      updateTask: (id, patch) =>
        set((s) => {
          const current = s.tasks.find((t) => t.id === id);
          if (!current) return s;
          // A commitment without a time is no longer fixed.
          const merge = (t: Task): Task => {
            // A new estimate replaces a shortened timebox.
            // A new estimate replaces a shortened timebox, and any answer to "how much is left?".
            const fresh = patch.planned !== undefined ? { ...(patch.blockMin === undefined ? { blockMin: null } : {}), ...(patch.left === undefined ? { left: null } : {}) } : {};
            const next = { ...t, ...fresh, ...patch };
            // Without a time there are no later blocks either.
            const timed = next.start === null ? { ...next, parts: null } : next;
            return timed.fixed && timed.start === null ? { ...timed, fixed: false } : timed;
          };
          let tasks = s.tasks.map((t) => (t.id === id ? merge(t) : t));
          // Making a finished task repeat starts the series from it right away.
          const merged = tasks.find((t) => t.id === id)!;
          if (patch.repeat && merged.done && !merged.nextId) {
            const spawned = spawnNext(tasks, merged, todayISO());
            tasks = spawned.tasks.map((t) => (t.id === id ? { ...t, nextId: spawned.nextId } : t));
          }
          // A change of day through a form field lands at the end of that day.
          if (patch.date !== undefined && patch.date !== current.date) {
            tasks = tasks.map((t) =>
              t.id === id
                ? {
                    ...t,
                    order: nextOrder(s.tasks, patch.date!),
                    start: patch.date === null ? null : (patch.start ?? (current.fixed ? current.start : null)),
                    fixed: patch.date === null ? false : t.fixed,
                  }
                : t,
            );
          }
          return keepWorkOnDay(s.tasks, tasks, s.days);
        }),

      setLeft: (id, min) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, left: { min, atSec: t.actualSec }, blockMin: null } : t)) })),

      deleteTask: (id) => {
        const task = get().tasks.find((t) => t.id === id) ?? null;
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
          timer: s.timer?.taskId === id ? null : s.timer,
          // A calendar meeting you deleted stays deleted when the calendar is imported again.
          ...(task?.calendarKey ? { settings: { ...s.settings, calendarHidden: [...(s.settings.calendarHidden ?? []), task.calendarKey].slice(-500) } } : {}),
        }));
        return task;
      },

      restoreTask: (task) =>
        set((s) =>
          s.tasks.some((t) => t.id === task.id)
            ? s
            : {
                tasks: [...s.tasks, task],
                ...(task.calendarKey ? { settings: { ...s.settings, calendarHidden: (s.settings.calendarHidden ?? []).filter((k) => k !== task.calendarKey) } } : {}),
              },
        ),

      toggleDone: (id) =>
        set((s) => {
          const settled = s.timer?.taskId === id ? settleTimer(s) : { tasks: s.tasks, timer: s.timer, days: s.days };
          const task = settled.tasks.find((t) => t.id === id);
          if (!task) return s;
          let tasks = settled.tasks;

          if (task.done) {
            // Taking back a repeating task also takes back the occurrence it created, unless that one was worked on.
            const spawned = task.nextId ? tasks.find((t) => t.id === task.nextId) : undefined;
            if (spawned && !spawned.done && spawned.actualSec === 0) tasks = tasks.filter((t) => t.id !== spawned.id);
            tasks = tasks.map((t) => (t.id === id ? { ...t, done: false, doneAt: null, nextId: null, unconfirmed: false } : t));
            return { timer: settled.timer, days: settled.days, tasks };
          }

          const now = new Date();
          const nowMin = now.getHours() * 60 + now.getMinutes();
          tasks = complete(tasks, task, todayISO(now));
          // With timer sessions, the timeline shows those; the task starts where the work started. Nothing is made up.
          const worked = sessionsOn(settled.tasks.find((t) => t.id === id)!, todayISO(now));
          if (!task.fixed && task.date === todayISO(now) && worked.length > 0) {
            tasks = tasks.map((t) => (t.id === id ? { ...t, start: worked[0].start, blockMin: null, parts: null } : t));
          } else if (!task.fixed && task.date === todayISO(now) && task.start !== null) {
            // Without tracked time: finishing early frees the slot planned for later,
            // and a block finished partway through shrinks to the time it took.
            const start = task.start;
            if (start > nowMin) {
              tasks = tasks.map((t) => (t.id === id ? { ...t, start: null, blockMin: null, parts: null } : t));
            } else if (start + lengthOf(task) > nowMin) {
              const took = Math.max(15, Math.ceil((nowMin - start) / 5) * 5);
              tasks = tasks.map((t) => (t.id === id ? { ...t, blockMin: took, parts: null } : t));
            } else {
              // Finished: later blocks planned for it are no longer needed.
              tasks = tasks.map((t) => (t.id === id ? { ...t, parts: null } : t));
            }
          }
          return { timer: settled.timer, days: settled.days, tasks };
        }),

      settleCommitments: (today, nowMin) =>
        set((s) => {
          const over = s.tasks.filter(
            (t) => t.fixed && !t.done && t.date !== null && t.start !== null && (t.date < today || (t.date === today && t.start + lengthOf(t) <= nowMin)),
          );
          if (over.length === 0) return s;
          let tasks = s.tasks;
          for (const t of over) tasks = complete(tasks, tasks.find((x) => x.id === t.id)!, today);
          // A meeting whose day passed with the app closed is counted, but not as confirmed.
          const unseen = new Set(over.filter((t) => t.date! < today).map((t) => t.id));
          return { tasks: unseen.size > 0 ? tasks.map((t) => (unseen.has(t.id) ? { ...t, unconfirmed: true } : t)) : tasks };
        }),

      moveTask: (id, date, index) => set((s) => keepWorkOnDay(s.tasks, moveTask(s.tasks, id, date, index), s.days)),

      sendTo: (id, date) => set((s) => keepWorkOnDay(s.tasks, moveTask(s.tasks, id, date, Number.MAX_SAFE_INTEGER), s.days)),

      bringBack: (id, date) =>
        set((s) =>
          keepWorkOnDay(
            s.tasks,
            moveTask(s.tasks, id, date, Number.MAX_SAFE_INTEGER).map((t) => (t.id === id ? { ...t, rolled: 0, parkedOn: null } : t)),
            s.days,
          ),
        ),

      defer: (id, date, options) => {
        const s = get();
        const task = s.tasks.find((t) => t.id === id);
        const counts = options?.counts !== false;
        const limit = s.settings.parkAfter === undefined ? 3 : s.settings.parkAfter;
        const parks = counts && Boolean(task) && limit !== null && task!.rolled >= limit && !servesObjective(s, todayISO())(task!);
        const moved = moveTask(s.tasks, id, parks ? null : date, Number.MAX_SAFE_INTEGER).map((t) =>
          t.id === id ? { ...t, rolled: t.rolled + (counts ? 1 : 0), parkedOn: parks ? date : t.parkedOn } : t,
        );
        // Putting a task off is moving on from the day it was on, and the time worked there stays there.
        set(keepWorkOnDay(s.tasks, moved, s.days, (t) => t.id === id));
        return parks ? 'backlog' : 'day';
      },

      rollover: (today) =>
        set((s) => {
          // Work left on Friday waits for Monday rather than filling the weekend.
          if (isWeekend(today) && !s.settings.weekendRollover) return s;
          const tasks = rollover(s.tasks, today, s.settings.parkAfter === undefined ? 3 : s.settings.parkAfter, servesObjective(s, today));
          if (tasks === s.tasks) return s;
          // Note on each day what left it unfinished, so the record of that day stays honest.
          return keepWorkOnDay(s.tasks, tasks, s.days, () => true);
        }),

      autoSchedule: (date, from, givenPace) => {
        const s = get();
        // The same rule as the planning ritual: at your measured pace unless that is switched off.
        const pace = givenPace ?? (s.settings.planAtPace !== false ? (paceOf(s.tasks) ?? undefined) : undefined);
        const day = tasksOn(s.tasks, date);
        // What has been worked today already counts against the day's capacity.
        // Whole minutes, so a stray second of tracked time cannot push a task under the half-hour floor.
        const budget = Math.max(0, Math.round(s.settings.capacityMin - workDone(day, s.days[date])));
        // Round as the scheduler does, so both agree on what is under way.
        const start = Math.ceil(Math.max(from, s.settings.dayStart * 60) / 5) * 5;
        const plan = planDay(day, start, s.settings.dayEnd * 60, breaksOf(s.settings), budget, pace, date);
        const scheduled = s.tasks.map((t) => {
          const placement = plan[t.id];
          if (placement === undefined) return t;
          if (placement === null) return { ...t, start: null, blockMin: null, parts: null };
          const [head, ...later] = placement.blocks;
          const length = head.end - head.start;
          return {
            ...t,
            start: head.start,
            blockMin: length === (t.planned ?? DEFAULT_BLOCK) ? null : length,
            parts: later.length > 0 ? later.map((b) => ({ start: b.start, length: b.end - b.start })) : null,
          };
        });
        // The list keeps the order you set: it is the priority the plan was made from.
        set({ tasks: scheduled });
        return {
          placed: Object.values(plan).filter((v) => v !== null).length,
          // A task past its estimate is not "does not fit": it waits for a new estimate.
          left: day.filter((t) => plan[t.id] === null && !estimateUsedUp(t)),
          partial: day
            .filter((t) => plan[t.id]?.partial)
            .map((t) => ({ task: t, minutes: plan[t.id]!.blocks.reduce((sum, b) => sum + b.end - b.start, 0), need: plan[t.id]!.need ?? 0 })),
          start,
        };
      },

      clearSchedule: (date) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.date === date && !t.done && !t.fixed && t.start !== null ? { ...t, start: null, blockMin: null, parts: null } : t)),
        })),

      importCalendar: (read, from, to, cal, name) => {
        const s = get();
        const { meetings } = read;
        let tasks = s.tasks;
        let added = 0;
        let updated = 0;
        const now = new Date();
        const today = todayISO(now);
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const lower = (x: string) => x.trim().toLowerCase();
        const same = (t: Task, m: Meeting) => t.fixed && t.start === m.start && lower(t.title) === lower(m.title);
        const keys = new Set(meetings.map((m) => m.key));
        const uidOf = (key: string) => key.split('|')[0];
        const uids = new Set(meetings.map((m) => uidOf(m.key)));

        // A repeating meeting typed into Kalm that the calendar also has: the calendar takes over, so it is not there twice.
        const titles = new Set(meetings.map((m) => lower(m.title)));
        const series = tasks.filter((t) => t.fixed && t.repeat && !t.calendarKey && !t.done && titles.has(lower(t.title)) && t.date !== null && t.date >= from);
        const replaced = [...new Set(series.map((t) => t.title))];
        tasks = tasks.flatMap((t) => (series.includes(t) ? (t.actualSec > 0 ? [{ ...t, repeat: null }] : []) : [t]));

        const hidden = new Set(s.settings.calendarHidden ?? []);
        for (const m of meetings) {
          if (hidden.has(m.key)) continue;
          const mine = tasks.find((t) => t.calendarKey === m.key);
          if (mine) {
            const changed = mine.title !== m.title || mine.date !== m.date || mine.start !== m.start || mine.planned !== m.length;
            if (!changed) continue;
            const ahead = m.date > today || (m.date === today && m.start + m.length > nowMin);
            // A meeting counted as held on its old day but since moved to a time still to come is back on.
            const revive = mine.done && mine.actualSec === 0 && ahead;
            if (mine.done && !revive) continue;
            updated++;
            tasks = tasks.map((t) =>
              t.id === mine.id
                ? {
                    ...t,
                    title: m.title,
                    date: m.date,
                    start: m.start,
                    planned: m.length,
                    blockMin: null,
                    fixed: true,
                    calendarId: cal,
                    order: t.date === m.date ? t.order : nextOrder(tasks, m.date),
                    ...(revive ? { done: false, doneAt: null, unconfirmed: false } : {}),
                  }
                : t,
            );
            continue;
          }
          // Already typed in by hand: link to it rather than add a copy.
          const typed = tasks.find((t) => !t.calendarKey && t.date === m.date && same(t, m));
          if (typed) {
            tasks = tasks.map((t) => (t.id === typed.id ? { ...t, calendarKey: m.key, calendarId: cal, planned: m.length } : t));
            continue;
          }
          const task: Task = {
            ...makeTask({ title: m.title, date: m.date, planned: m.length, start: m.start, fixed: true }, nextOrder(tasks, m.date)),
            calendarKey: m.key,
            calendarId: cal,
          };
          tasks = [...tasks, task];
          added++;
        }
        // Gone from the calendar: cancelled, declined or moved out of range. Work already done on it stays.
        const gone = tasks.filter(
          (t) =>
            t.calendarKey &&
            !keys.has(t.calendarKey) &&
            (t.calendarId === cal || uids.has(uidOf(t.calendarKey))) &&
            t.date !== null &&
            t.date >= from &&
            t.date <= to &&
            !t.done &&
            t.actualSec === 0,
        );
        tasks = tasks.filter((t) => !gone.includes(t));
        // All-day events of this calendar, day by day: this import replaces what the last one said.
        const days = { ...s.days };
        for (let d = from; d <= to; d = addDays(d, 1)) {
          const others = (days[d]?.allDay ?? []).filter((x) => x.cal !== cal);
          const mineAllDay = read.allDay.filter((x) => x.date === d).map((x) => ({ title: x.title, cal }));
          if (others.length + mineAllDay.length > 0 || days[d]?.allDay) days[d] = { ...days[d], allDay: [...others, ...mineAllDay] };
        }
        const at = new Date().toISOString();
        set({
          tasks,
          days,
          settings: { ...s.settings, calendarImport: { name, at }, calendarImports: { ...(s.settings.calendarImports ?? {}), [cal]: { name, at } } },
        });
        return { added, updated, removed: gone.length, replaced };
      },

      removeExamples: () =>
        set((s) => {
          const tasks = s.tasks.filter((t) => !t.example);
          // The starter channels go too, unless something of yours uses them.
          const used = new Set(tasks.map((t) => t.channelId));
          return { tasks, channels: s.channels.filter((c) => !STARTER_CHANNELS.includes(c.id) || used.has(c.id)) };
        }),

      addSubtask: (taskId, title) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, subtasks: [...t.subtasks, { id: uid(), title: title.trim(), done: false }] } : t,
          ),
        })),

      updateSubtask: (taskId, subId, patch) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, subtasks: t.subtasks.map((x) => (x.id === subId ? { ...x, ...patch } : x)) } : t,
          ),
        })),

      deleteSubtask: (taskId, subId) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, subtasks: t.subtasks.filter((x) => x.id !== subId) } : t)),
        })),

      startTimer: (id) =>
        set((s) => {
          if (s.timer?.taskId === id) return s;
          return { ...settleTimer(s), timer: { taskId: id, startedAt: Date.now() } };
        }),

      stopTimer: (endAt) => set((s) => settleTimer(s, endAt)),

      confirmTimer: () => set((s) => (s.timer ? { timer: { ...s.timer, checkedAt: Date.now() } } : s)),

      channelByName: (name) => {
        const wanted = slug(name);
        const channels = get().channels;
        const hit = channels.find((c) => c.name === wanted) ?? channels.find((c) => wanted !== '' && c.name.startsWith(wanted));
        if (hit) return hit.id;
        const channel: Channel = {
          id: uid(),
          name: wanted || 'channel',
          color: CHANNEL_COLORS[channels.length % CHANNEL_COLORS.length],
        };
        set({ channels: [...channels, channel] });
        return channel.id;
      },

      updateChannel: (id, patch) =>
        set((s) => ({
          channels: s.channels.map((c) =>
            c.id === id ? { ...c, ...patch, name: patch.name !== undefined ? slug(patch.name) || c.name : c.name } : c,
          ),
        })),

      deleteChannel: (id) =>
        set((s) => ({
          channels: s.channels.filter((c) => c.id !== id),
          tasks: s.tasks.map((t) => (t.channelId === id ? { ...t, channelId: null } : t)),
        })),

      addObjective: (title, week) =>
        set((s) => ({ objectives: [...s.objectives, { id: uid(), weekStart: week, title: title.trim(), done: false }] })),

      updateObjective: (id, patch) =>
        set((s) => ({ objectives: s.objectives.map((o) => (o.id === id ? { ...o, ...patch } : o)) })),

      deleteObjective: (id) => {
        const objective = get().objectives.find((o) => o.id === id);
        if (!objective) return null;
        const linked = get().tasks.filter((t) => t.objectiveId === id).map((t) => t.id);
        set((s) => ({
          objectives: s.objectives.filter((o) => o.id !== id),
          tasks: s.tasks.map((t) => (t.objectiveId === id ? { ...t, objectiveId: null } : t)),
        }));
        return { objective, linked };
      },

      restoreObjective: (objective, linked) =>
        set((s) => ({
          objectives: s.objectives.some((o) => o.id === objective.id) ? s.objectives : [...s.objectives, objective],
          tasks: s.tasks.map((t) => (linked.includes(t.id) ? { ...t, objectiveId: objective.id } : t)),
        })),

      setDay: (date, patch) => set((s) => ({ days: { ...s.days, [date]: { ...s.days[date], ...patch } } })),

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      importData: (data) => {
        set({ ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings } });
        // Bring the restored data up to today at once: carry unfinished tasks over and settle past meetings.
        const now = new Date();
        if (get().settings.autoRollover) get().rollover(todayISO(now));
        get().settleCommitments(todayISO(now), now.getHours() * 60 + now.getMinutes());
      },

      reset: () => set({ ...seed(todayISO()), tasks: [], objectives: [] }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      partialize: (s): PlannerData => ({
        tasks: s.tasks,
        channels: s.channels,
        objectives: s.objectives,
        days: s.days,
        settings: s.settings,
        timer: s.timer,
      }),
    },
  ),
);

export function snapshot(): PlannerData {
  const s = useStore.getState();
  return { tasks: s.tasks, channels: s.channels, objectives: s.objectives, days: s.days, settings: s.settings, timer: s.timer };
}

/** Checks that a parsed backup file has the shape of planner data. */
export function isPlannerData(value: unknown): value is PlannerData {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.tasks) &&
    v.tasks.every((t) => typeof t === 'object' && t !== null && typeof (t as Task).id === 'string' && typeof (t as Task).title === 'string') &&
    Array.isArray(v.channels) &&
    Array.isArray(v.objectives) &&
    typeof v.days === 'object' &&
    v.days !== null &&
    typeof v.settings === 'object' &&
    v.settings !== null
  );
}
