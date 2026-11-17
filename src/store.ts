import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Channel, DayLog, ISODate, Objective, PlannerData, Settings, Subtask, Task } from './types';
import { addDays, todayISO, weekStart } from './lib/dates';
import { autoSchedule, byTime, lengthOf, moveTask, nextOccurrence, remainingOf, rollover, tasksOn, type Span } from './lib/model';

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
  deleteTask: (id: string) => Task | null;
  restoreTask: (task: Task) => void;
  toggleDone: (id: string) => void;
  /** Marks fixed commitments that are over as done, and creates the next one of a repeating commitment. */
  settleCommitments: (today: ISODate, nowMin: number) => void;
  moveTask: (id: string, date: ISODate | null, index: number) => void;
  /** Moves a task to the end of a day or the backlog. */
  sendTo: (id: string, date: ISODate | null) => void;
  rollover: (today: ISODate) => void;
  /** Replans the flexible tasks of a day. Returns how many got a time and which did not fit. */
  autoSchedule: (date: ISODate, from: number) => { placed: number; left: Task[] };
  clearSchedule: (date: ISODate) => void;
  removeExamples: () => void;

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
  deleteObjective: (id: string) => void;

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

/** No single sitting is longer than this. A timer left on overnight stops counting here. */
export const MAX_SESSION_SEC = 8 * 3600;

/** Adds the running timer's elapsed time to its task. */
function settleTimer(state: PlannerData, now = Date.now()): Pick<PlannerData, 'tasks' | 'timer'> {
  if (!state.timer) return { tasks: state.tasks, timer: null };
  const { taskId, startedAt } = state.timer;
  const elapsed = Math.min(MAX_SESSION_SEC, Math.max(0, Math.round((now - startedAt) / 1000)));
  return {
    tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, actualSec: t.actualSec + elapsed } : t)),
    timer: null,
  };
}

/**
 * Marks a task done. A repeating task gets its next occurrence: the first due
 * day after the one it was due on, and never earlier than today, so a missed
 * week does not come back as five copies.
 */
function complete(tasks: Task[], task: Task, today: ISODate): Task[] {
  let nextId: string | null = null;
  let out = tasks;
  if (task.repeat) {
    const due = task.date ?? today;
    const yesterday = addDays(today, -1);
    const date = nextOccurrence(task.repeat, task.repeatFrom ?? due, due > yesterday ? due : yesterday);
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
      ...makeTask(input, nextOrder(out, date)),
      subtasks: task.subtasks.map((x) => ({ ...x, id: uid(), done: false })),
      repeat: task.repeat,
      repeatFrom: date,
    };
    out = [...out, next];
    nextId = next.id;
  }
  return out.map((t) => (t.id === task.id ? { ...t, done: true, doneAt: new Date().toISOString(), nextId } : t));
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
            const next = { ...t, ...(patch.planned !== undefined && patch.blockMin === undefined ? { blockMin: null } : {}), ...patch };
            return next.fixed && next.start === null ? { ...next, fixed: false } : next;
          };
          let tasks = s.tasks.map((t) => (t.id === id ? merge(t) : t));
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
          return { tasks };
        }),

      deleteTask: (id) => {
        const task = get().tasks.find((t) => t.id === id) ?? null;
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
          timer: s.timer?.taskId === id ? null : s.timer,
        }));
        return task;
      },

      restoreTask: (task) => set((s) => (s.tasks.some((t) => t.id === task.id) ? s : { tasks: [...s.tasks, task] })),

      toggleDone: (id) =>
        set((s) => {
          const settled = s.timer?.taskId === id ? settleTimer(s) : { tasks: s.tasks, timer: s.timer };
          const task = settled.tasks.find((t) => t.id === id);
          if (!task) return s;
          let tasks = settled.tasks;

          if (task.done) {
            // Taking back a repeating task also takes back the occurrence it created, unless that one was worked on.
            const spawned = task.nextId ? tasks.find((t) => t.id === task.nextId) : undefined;
            if (spawned && !spawned.done && spawned.actualSec === 0) tasks = tasks.filter((t) => t.id !== spawned.id);
            tasks = tasks.map((t) => (t.id === id ? { ...t, done: false, doneAt: null, nextId: null } : t));
            return { timer: settled.timer, tasks };
          }

          const now = new Date();
          const nowMin = now.getHours() * 60 + now.getMinutes();
          tasks = complete(tasks, task, todayISO(now));
          // Finishing early frees the slot that was planned for it later today,
          // and a block finished partway through shrinks to the time it took.
          if (!task.fixed && task.date === todayISO(now) && task.start !== null) {
            const start = task.start;
            if (start > nowMin) {
              tasks = tasks.map((t) => (t.id === id ? { ...t, start: null, blockMin: null } : t));
            } else if (start + lengthOf(task) > nowMin) {
              const took = Math.max(15, Math.ceil((nowMin - start) / 5) * 5);
              tasks = tasks.map((t) => (t.id === id ? { ...t, blockMin: took } : t));
            }
          }
          return { timer: settled.timer, tasks };
        }),

      settleCommitments: (today, nowMin) =>
        set((s) => {
          const over = s.tasks.filter(
            (t) =>
              (t.fixed && !t.done && t.date !== null && t.start !== null && (t.date < today || (t.date === today && t.start + lengthOf(t) <= nowMin))) ||
              // A finished task that was set to repeat afterwards still gets its next occurrence.
              (t.done && t.repeat && !t.nextId && t.date !== null),
          );
          if (over.length === 0) return s;
          let tasks = s.tasks;
          for (const t of over) tasks = complete(tasks, tasks.find((x) => x.id === t.id)!, today);
          return { tasks };
        }),

      moveTask: (id, date, index) => set((s) => ({ tasks: moveTask(s.tasks, id, date, index) })),

      sendTo: (id, date) => set((s) => ({ tasks: moveTask(s.tasks, id, date, Number.MAX_SAFE_INTEGER) })),

      rollover: (today) =>
        set((s) => {
          const tasks = rollover(s.tasks, today);
          if (tasks === s.tasks) return s;
          // Note on each day what left it unfinished, so the record of that day stays honest.
          const days = { ...s.days };
          for (const before of s.tasks) {
            const after = tasks.find((t) => t.id === before.id);
            if (!before.date || !after || after.date === before.date) continue;
            const log = days[before.date] ?? {};
            days[before.date] = {
              ...log,
              carried: (log.carried ?? 0) + 1,
              carriedMin: (log.carriedMin ?? 0) + (before.planned ?? 0),
              // The time worked that day stays with that day.
              carriedSec: (log.carriedSec ?? 0) + before.actualSec - (before.trackedBefore ?? 0),
            };
          }
          return { tasks, days };
        }),

      autoSchedule: (date, from) => {
        const s = get();
        const day = tasksOn(s.tasks, date);
        // Work already finished today counts against the day's capacity.
        const doneToday = day.filter((t) => t.done && !t.fixed).reduce((sum, t) => sum + (t.planned ?? 0), 0);
        const budget = Math.max(0, s.settings.capacityMin - doneToday);
        const plan = autoSchedule(day, Math.max(from, s.settings.dayStart * 60), s.settings.dayEnd * 60, breaksOf(s.settings), budget);
        const scheduled = s.tasks.map((t) => {
          if (plan[t.id] === undefined) return t;
          const length = remainingOf(t);
          return { ...t, start: plan[t.id], blockMin: plan[t.id] !== null && length !== (t.planned ?? length) ? length : null };
        });
        // The list now reads in the order the day will go.
        const order = new Map(byTime(tasksOn(scheduled, date)).map((t, i) => [t.id, i]));
        set({ tasks: scheduled.map((t) => (order.has(t.id) ? { ...t, order: order.get(t.id)! } : t)) });
        return {
          placed: Object.values(plan).filter((v) => v !== null).length,
          left: day.filter((t) => plan[t.id] === null),
        };
      },

      clearSchedule: (date) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.date === date && !t.done && !t.fixed && t.start !== null ? { ...t, start: null } : t)),
        })),

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
          return { tasks: settleTimer(s).tasks, timer: { taskId: id, startedAt: Date.now() } };
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

      deleteObjective: (id) =>
        set((s) => ({
          objectives: s.objectives.filter((o) => o.id !== id),
          tasks: s.tasks.map((t) => (t.objectiveId === id ? { ...t, objectiveId: null } : t)),
        })),

      setDay: (date, patch) => set((s) => ({ days: { ...s.days, [date]: { ...s.days[date], ...patch } } })),

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      importData: (data) => set({ ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings } }),

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
