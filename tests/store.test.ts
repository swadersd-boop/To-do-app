import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SESSION_SEC, useStore } from '../src/store';
import { addDays, todayISO } from '../src/lib/dates';

const today = todayISO();
const yesterday = addDays(today, -1);
const store = () => useStore.getState();
const find = (id: string) => store().tasks.find((t) => t.id === id)!;

beforeEach(() => {
  vi.useRealTimers();
  store().reset();
});

describe('store', () => {
  it('starts empty after a reset, with the default channels', () => {
    expect(store().tasks).toEqual([]);
    expect(store().channels.length).toBeGreaterThan(0);
  });

  it('records what a day left unfinished when tasks roll over', () => {
    const done = store().addTask({ title: 'Done', date: yesterday, planned: 30 });
    store().toggleDone(done);
    const open = store().addTask({ title: 'Open', date: yesterday, planned: 45 });
    store().addTask({ title: 'Also open', date: yesterday, planned: 15 });
    const dinner = store().addTask({ title: 'Dinner', date: yesterday, planned: 90, start: 1200, fixed: true });

    store().rollover(today);

    expect(find(open)).toMatchObject({ date: today, rolled: 1 });
    expect(find(done).date).toBe(yesterday);
    expect(find(dinner)).toMatchObject({ date: yesterday, start: 1200 });
    expect(store().days[yesterday]).toMatchObject({ carried: 2, carriedMin: 60 });

    store().rollover(today);
    expect(store().days[yesterday].carried).toBe(2);
  });

  it('creates the next occurrence of a repeating task, and takes it back', () => {
    const id = store().addTask({ title: 'Standup', date: today, planned: 15, start: 570, fixed: true });
    store().updateTask(id, { repeat: 'daily', repeatFrom: today });
    store().toggleDone(id);

    const next = store().tasks.find((t) => t.title === 'Standup' && !t.done)!;
    expect(next).toMatchObject({ date: addDays(today, 1), repeat: 'daily', start: 570, fixed: true, actualSec: 0 });
    expect(find(id).nextId).toBe(next.id);

    store().toggleDone(id);
    expect(store().tasks.filter((t) => t.title === 'Standup')).toHaveLength(1);
  });

  it('does not copy a flexible timebox to the next occurrence', () => {
    const id = store().addTask({ title: 'Inbox', date: today, planned: 20, start: 585 });
    store().updateTask(id, { repeat: 'daily', repeatFrom: today });
    store().toggleDone(id);
    expect(store().tasks.find((t) => t.title === 'Inbox' && !t.done)!.start).toBeNull();
  });

  it('keeps a repeating task repeating from the backlog', () => {
    const id = store().addTask({ title: 'Water plants', date: today });
    store().updateTask(id, { repeat: 'daily', repeatFrom: today });
    store().sendTo(id, null);
    store().toggleDone(id);
    expect(store().tasks.find((t) => t.title === 'Water plants' && !t.done)).toMatchObject({ date: addDays(today, 1), repeat: 'daily' });
  });

  it('drops "fixed" when a task loses its time', () => {
    const id = store().addTask({ title: 'Call', date: today, start: 600, fixed: true });
    store().updateTask(id, { start: null });
    expect(find(id).fixed).toBe(false);
    const other = store().addTask({ title: 'Review', date: today, start: 660, fixed: true });
    store().updateTask(other, { date: null });
    expect(find(other)).toMatchObject({ start: null, fixed: false });
  });

  it('keeps a fixed time when the day changes, and leaves it alone on "Clear"', () => {
    const id = store().addTask({ title: 'Call', date: today, start: 600, fixed: true });
    const flex = store().addTask({ title: 'Write', date: today, start: 700 });
    store().clearSchedule(today);
    expect(find(id).start).toBe(600);
    expect(find(flex).start).toBeNull();
    store().updateTask(id, { date: addDays(today, 2) });
    expect(find(id)).toMatchObject({ date: addDays(today, 2), start: 600 });
  });

  it('tracks time, and never counts more than one long sitting', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 16, 9, 0));
    const id = store().addTask({ title: 'Write', date: today, planned: 60 });
    store().startTimer(id);
    vi.setSystemTime(new Date(2026, 10, 16, 9, 25));
    store().stopTimer();
    expect(find(id).actualSec).toBe(25 * 60);

    store().startTimer(id);
    vi.setSystemTime(new Date(2026, 10, 17, 7, 0));
    store().stopTimer();
    expect(find(id).actualSec).toBe(25 * 60 + MAX_SESSION_SEC);
  });

  it('can stop a timer at an earlier moment', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 16, 9, 0));
    const id = store().addTask({ title: 'Write', date: today });
    store().startTimer(id);
    const fortyMinutesIn = Date.now() + 40 * 60_000;
    vi.setSystemTime(new Date(2026, 10, 16, 13, 0));
    store().stopTimer(fortyMinutesIn);
    expect(find(id).actualSec).toBe(40 * 60);
    expect(store().timer).toBeNull();
  });

  it('removes only the example tasks', () => {
    store().importData({ ...store(), tasks: [] });
    const mine = store().addTask({ title: 'Mine', date: today });
    store().addTask({ title: 'Example', date: today, example: true });
    store().removeExamples();
    expect(store().tasks.map((t) => t.id)).toEqual([mine]);
  });
});
