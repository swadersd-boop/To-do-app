import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Channel, DayLog, ISODate, Objective, PlannerData, Settings, Subtask, Task } from './types';
import { addDays, todayISO, weekStart } from './lib/dates';
import { autoSchedule, moveTask, nextOccurrence, rollover, tasksOn } from './lib/model';

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
};

export interface NewTask {
  title: string;
  date: ISODate | null;
  planned?: number | null;
  channelId?: string | null;
  start?: number | null;
  notes?: string;
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
  };
}

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
    { title: 'Drag this card onto the timeline to give it a time', date: today, planned: 45, channelId: 'deep' },
    { title: 'Hover a card and press play to focus on it', date: today, planned: 25, channelId: 'work' },
    { title: 'Drag me to another day', date: today, planned: 15, channelId: 'personal' },
    { title: 'Type "Call the dentist 15m #personal" in the box above', date: tomorrow, planned: 5, channelId: 'admin' },
    { title: 'Things without a day live here until you pull them in', date: null, planned: 30, channelId: null },
  ];
  const counts = new Map<string, number>();
  const tasks = starter.map((t) => {
    const key = String(t.date);
    const order = counts.get(key) ?? 0;
    counts.set(key, order + 1);
    return makeTask(t, order);
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
  moveTask: (id: string, date: ISODate | null, index: number) => void;
  /** Moves a task to the end of a day or the backlog. */
  sendTo: (id: string, date: ISODate | null) => void;
  rollover: (today: ISODate) => void;
  autoSchedule: (date: ISODate, from: number) => number;
  clearSchedule: (date: ISODate) => void;

  addSubtask: (taskId: string, title: string) => void;
  updateSubtask: (taskId: string, subId: string, patch: Partial<Subtask>) => void;
  deleteSubtask: (taskId: string, subId: string) => void;

  startTimer: (id: string) => void;
  stopTimer: () => void;

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

/** Adds the running timer's elapsed time to its task. */
function settleTimer(state: PlannerData, now = Date.now()): Pick<PlannerData, 'tasks' | 'timer'> {
  if (!state.timer) return { tasks: state.tasks, timer: null };
  const { taskId, startedAt } = state.timer;
  const elapsed = Math.max(0, Math.round((now - startedAt) / 1000));
  return {
    tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, actualSec: t.actualSec + elapsed } : t)),
    timer: null,
  };
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
          let tasks = s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
          // A change of day through a form field lands at the end of that day.
          if (patch.date !== undefined && patch.date !== current.date) {
            tasks = tasks.map((t) =>
              t.id === id
                ? { ...t, order: nextOrder(s.tasks, patch.date!), start: patch.date === null ? null : (patch.start ?? null) }
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

          let nextId: string | null = null;
          if (task.repeat && task.date) {
            const today = todayISO();
            const date = nextOccurrence(task.repeat, task.repeatFrom ?? task.date, task.date > today ? task.date : today);
            const next: Task = {
              ...makeTask({ title: task.title, date, planned: task.planned, channelId: task.channelId, notes: task.notes, start: task.start }, nextOrder(tasks, date)),
              subtasks: task.subtasks.map((x) => ({ ...x, id: uid(), done: false })),
              repeat: task.repeat,
              repeatFrom: date,
            };
            tasks = [...tasks, next];
            nextId = next.id;
          }
          tasks = tasks.map((t) => (t.id === id ? { ...t, done: true, doneAt: new Date().toISOString(), nextId } : t));
          return { timer: settled.timer, tasks };
        }),

      moveTask: (id, date, index) => set((s) => ({ tasks: moveTask(s.tasks, id, date, index) })),

      sendTo: (id, date) => set((s) => ({ tasks: moveTask(s.tasks, id, date, Number.MAX_SAFE_INTEGER) })),

      rollover: (today) =>
        set((s) => {
          const tasks = rollover(s.tasks, today);
          return tasks === s.tasks ? s : { tasks };
        }),

      autoSchedule: (date, from) => {
        const s = get();
        const placed = autoSchedule(tasksOn(s.tasks, date), Math.max(from, s.settings.dayStart * 60), s.settings.dayEnd * 60);
        set({ tasks: s.tasks.map((t) => (placed[t.id] === undefined ? t : { ...t, start: placed[t.id] })) });
        return Object.keys(placed).length;
      },

      clearSchedule: (date) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.date === date && !t.done && t.start !== null ? { ...t, start: null } : t)) })),

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

      stopTimer: () => set((s) => settleTimer(s)),

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

      reset: () => set({ ...seed(todayISO()) }),
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
