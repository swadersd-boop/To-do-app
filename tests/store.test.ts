import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SESSION_SEC, useStore } from '../src/store';
import { addDays, todayISO } from '../src/lib/dates';
import { tasksOn } from '../src/lib/model';

const today = todayISO();
const yesterday = addDays(today, -1);
const store = () => useStore.getState();
const find = (id: string) => store().tasks.find((t) => t.id === id)!;

beforeEach(() => {
  vi.useRealTimers();
  store().reset();
  // These tests use the real date, so rollover must not depend on whether today is a weekend.
  store().setSettings({ weekendRollover: true });
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

  it('completes a meeting when it is over and creates the next one, without a tick', () => {
    const monday = addDays(today, -1);
    const id = store().addTask({ title: 'Standup', date: monday, planned: 15, start: 570, fixed: true });
    store().updateTask(id, { repeat: 'daily', repeatFrom: monday });
    store().settleCommitments(today, 8 * 60);
    expect(find(id).done).toBe(true);
    const next = store().tasks.filter((t) => t.title === 'Standup' && !t.done);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ date: today, start: 570, fixed: true });
    // Today's has not happened yet at 08:00, and is done once it is over.
    expect(next[0].done).toBe(false);
    store().settleCommitments(today, 9 * 60 + 50);
    expect(find(next[0].id).done).toBe(true);
    expect(store().tasks.filter((t) => t.title === 'Standup' && !t.done)[0].date).toBe(addDays(today, 1));
  });

  it('creates the next occurrence when a finished task is set to repeat afterwards', () => {
    const id = store().addTask({ title: 'Standup', date: today, planned: 15, start: 570, fixed: true });
    store().settleCommitments(today, 12 * 60);
    expect(find(id).done).toBe(true);
    store().updateTask(id, { repeat: 'weekdays', repeatFrom: today });
    store().settleCommitments(today, 12 * 60);
    expect(store().tasks.filter((t) => t.title === 'Standup' && !t.done)).toHaveLength(1);
    store().settleCommitments(today, 12 * 60);
    expect(store().tasks.filter((t) => t.title === 'Standup')).toHaveLength(2);
  });

  it('restores a history of a repeating meeting without making extra copies', () => {
    const history = [-9, -8, -7, -6, -5].map((d) => {
      const date = addDays(today, d);
      return { ...store().tasks[0], id: `s${d}`, title: 'Standup', date, start: 570, planned: 15, fixed: true, done: true, repeat: 'weekdays' as const, repeatFrom: date, nextId: null };
    });
    store().addTask({ title: 'placeholder', date: today });
    store().importData({ ...store(), tasks: history });
    store().settleCommitments(today, 8 * 60);
    expect(store().tasks.filter((t) => t.title === 'Standup' && !t.done)).toHaveLength(0);
    store().rollover(today);
    expect(store().tasks).toHaveLength(5);
  });

  it('keeps a series to one open occurrence', () => {
    const id = store().addTask({ title: 'Inbox', date: today, planned: 15 });
    store().updateTask(id, { repeat: 'daily', repeatFrom: today });
    store().toggleDone(id);
    // Unticking and ticking again: still exactly one open occurrence.
    store().toggleDone(id);
    store().toggleDone(id);
    expect(store().tasks.filter((t) => t.title === 'Inbox' && !t.done)).toHaveLength(1);
    // Once the next one has been worked on, unticking keeps it, and ticking again must not add a second.
    const next = store().tasks.find((t) => t.title === 'Inbox' && !t.done)!;
    store().updateTask(next.id, { actualSec: 300 });
    store().toggleDone(id);
    store().toggleDone(id);
    expect(store().tasks.filter((t) => t.title === 'Inbox' && !t.done).map((t) => t.id)).toEqual([next.id]);
  });

  it('does not bring back a whole missed week of a repeating meeting', () => {
    const lastWeek = addDays(today, -6);
    const id = store().addTask({ title: 'Standup', date: lastWeek, planned: 15, start: 570, fixed: true });
    store().updateTask(id, { repeat: 'daily', repeatFrom: lastWeek });
    store().settleCommitments(today, 8 * 60);
    expect(store().tasks.filter((t) => t.title === 'Standup')).toHaveLength(2);
    expect(store().tasks.find((t) => t.title === 'Standup' && !t.done)!.date).toBe(today);
  });

  it('keeps the time worked on a day with that day when the task rolls over', () => {
    const id = store().addTask({ title: 'Proposal', date: yesterday, planned: 120 });
    store().updateTask(id, { actualSec: 75 * 60 });
    store().rollover(today);
    expect(find(id)).toMatchObject({ date: today, actualSec: 75 * 60, trackedBefore: 75 * 60 });
    expect(store().days[yesterday].carriedSec).toBe(75 * 60);
  });

  it('frees the later slot of a task finished early', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 16, 11, 0));
    const day = todayISO();
    const id = store().addTask({ title: 'Deck', date: day, planned: 60, start: 14 * 60 });
    store().toggleDone(id);
    expect(find(id)).toMatchObject({ done: true, start: null });
  });

  it('shrinks a block finished partway through to the time it took', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 16, 9, 42));
    const day = todayISO();
    const id = store().addTask({ title: 'Brief', date: day, planned: 90, start: 9 * 60 + 15 });
    store().toggleDone(id);
    expect(find(id)).toMatchObject({ start: 555, blockMin: 30 });
  });

  it('draws a finished task where the work happened, not where it was planned', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 16, 17, 31));
    const day = todayISO();
    const id = store().addTask({ title: 'Plan team offsite', date: day, planned: 60, start: 15 * 60 + 45 });
    store().updateTask(id, { actualSec: 70 * 60 });
    store().toggleDone(id);
    expect(find(id)).toMatchObject({ start: 16 * 60 + 20, blockMin: 70 });
  });

  it('remembers which tasks a day carried over', () => {
    store().addTask({ title: 'Write appendix', date: yesterday, planned: 45 });
    store().addTask({ title: 'Call Ana', date: yesterday, planned: 15 });
    store().rollover(today);
    expect(store().days[yesterday].carriedTitles).toEqual(['Write appendix', 'Call Ana']);
  });

  it('brings a restored backup up to date straight away', () => {
    const data = { ...store(), tasks: [{ ...store().tasks[0], id: 'old', title: 'Left on Friday', date: addDays(today, -3), done: false, order: 0, start: null, fixed: false, planned: 30, actualSec: 0 }] };
    store().importData(data);
    expect(find('old').date).toBe(today);
  });

  it('leaves unfinished work on Friday over the weekend unless asked', () => {
    const saturday = '2026-11-21';
    const friday = '2026-11-20';
    store().setSettings({ weekendRollover: false });
    const id = store().addTask({ title: 'Appendix', date: friday, planned: 45 });
    store().rollover(saturday);
    expect(find(id).date).toBe(friday);
    store().setSettings({ weekendRollover: true });
    store().rollover(saturday);
    expect(find(id).date).toBe(saturday);
  });

  it('plans from the next five minutes and lets the next task follow straight on', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 16, 11, 31));
    const day = todayISO();
    store().setSettings({ lunchStart: null, planAtPace: false });
    const id = store().addTask({ title: 'Brief', date: day, planned: 60, start: 11 * 60 + 40 });
    store().updateTask(id, { actualSec: 20 * 60 });
    const next = store().addTask({ title: 'Emails', date: day, planned: 30 });
    store().autoSchedule(day, 11 * 60 + 31);
    // Planning starts at 11:35, before the 11:40 start, so nothing is under way yet:
    // the 40 minutes still needed start at 11:35 and the next task follows straight on.
    expect(find(id)).toMatchObject({ start: 695, blockMin: 40 });
    expect(find(next).start).toBe(735);
  });

  it('keeps the work done on a task that moves on in that day\'s record', () => {
    const id = store().addTask({ title: 'Design onboarding', date: yesterday, planned: 180, start: 780 });
    store().updateTask(id, { actualSec: 90 * 60 });
    store().rollover(today);
    expect(store().days[yesterday].carriedWork).toEqual([{ title: 'Design onboarding', start: 780, sec: 90 * 60 }]);
    // The next day only counts what was worked there.
    store().updateTask(id, { actualSec: 100 * 60 });
    store().rollover(addDays(today, 1));
    expect(store().days[today]?.carriedWork).toEqual([{ title: 'Design onboarding', start: null, sec: 10 * 60 }]);
  });

  it('parks a task in the backlog after it has moved on three times', () => {
    const id = store().addTask({ title: 'Stale idea', date: yesterday, planned: 30 });
    store().updateTask(id, { rolled: 3 });
    store().rollover(today);
    expect(find(id)).toMatchObject({ date: null, parkedOn: today, rolled: 4 });
    store().setSettings({ parkAfter: null });
    const keep = store().addTask({ title: 'Keeps going', date: yesterday, planned: 30 });
    store().updateTask(keep, { rolled: 7 });
    store().rollover(today);
    expect(find(keep).date).toBe(today);
  });

  it('puts leftovers after what was already planned for today', () => {
    const ahead = store().addTask({ title: 'Planned ahead', date: today, planned: 30 });
    const left = store().addTask({ title: 'Leftover', date: yesterday, planned: 30 });
    store().rollover(today);
    expect(tasksOn(store().tasks, today).map((t) => t.id)).toEqual([ahead, left]);
  });

  it('settles a day that was skipped: its standup counts as held and the next one exists', () => {
    const wed = addDays(today, -2);
    const thu = addDays(today, -1);
    const w = store().addTask({ title: 'Standup', date: wed, planned: 15, start: 570, fixed: true });
    store().updateTask(w, { repeat: 'daily', repeatFrom: wed });
    store().settleCommitments(wed, 12 * 60);
    expect(store().tasks.find((t) => t.title === 'Standup' && t.date === thu)?.done).toBe(false);
    // The app is not opened on Thursday. Friday morning:
    store().settleCommitments(today, 8 * 60);
    store().rollover(today);
    expect(store().tasks.find((t) => t.title === 'Standup' && t.date === thu)?.done).toBe(true);
    expect(store().tasks.filter((t) => t.title === 'Standup' && !t.done).map((t) => t.date)).toEqual([today]);
  });

  it('counts putting a task off as moving on, so it parks like a carried one', () => {
    const id = store().addTask({ title: 'Someday report', date: today, planned: 60 });
    for (let i = 0; i < 3; i++) store().defer(id, addDays(today, i + 1));
    expect(find(id)).toMatchObject({ rolled: 3, date: addDays(today, 3) });
    store().rollover(addDays(today, 4));
    expect(find(id)).toMatchObject({ date: null, parkedOn: addDays(today, 4) });
  });

  it('parks a task that is put off once too often', () => {
    const id = store().addTask({ title: 'Someday deck', date: today, planned: 60 });
    store().updateTask(id, { rolled: 3 });
    expect(store().defer(id, addDays(today, 1))).toBe('backlog');
    expect(find(id)).toMatchObject({ date: null, parkedOn: addDays(today, 1), rolled: 4 });
  });

  it('starts the count again for a task brought back from the backlog', () => {
    const id = store().addTask({ title: 'Design onboarding', date: yesterday, planned: 60 });
    store().updateTask(id, { rolled: 3 });
    store().rollover(today);
    expect(find(id).date).toBeNull();
    store().bringBack(id, today);
    expect(find(id)).toMatchObject({ date: today, rolled: 0, parkedOn: null });
  });

  it('marks a meeting from a day the app was not open as passed, not attended', () => {
    const id = store().addTask({ title: 'Standup', date: yesterday, planned: 15, start: 570, fixed: true });
    const same = store().addTask({ title: 'Review', date: today, planned: 30, start: 540, fixed: true });
    store().settleCommitments(today, 12 * 60);
    expect(find(id)).toMatchObject({ done: true, unconfirmed: true });
    expect(find(same)).toMatchObject({ done: true });
    expect(find(same).unconfirmed).toBeFalsy();
  });

  it('charges capacity with the time actually worked today, not the estimates of finished tasks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 17, 10, 20));
    const day = todayISO();
    store().setSettings({ capacityMin: 180, lunchStart: null, planAtPace: false });
    // Finished this morning after 33 minutes; the rest of its time was worked yesterday.
    const onboarding = store().addTask({ title: 'Design onboarding', date: day, planned: 120 });
    store().updateTask(onboarding, { actualSec: 128 * 60, trackedBefore: 95 * 60, done: true });
    // Finished without the timer: its estimate counts as the work it took.
    const blog = store().addTask({ title: 'Blog post', date: day, planned: 60 });
    store().updateTask(blog, { done: true });
    const offsite = store().addTask({ title: 'Plan team offsite', date: day, planned: 60 });
    const result = store().autoSchedule(day, 620);
    expect(result.left).toEqual([]);
    expect(find(offsite).start).toBe(620);
  });

  it('removes only the example tasks', () => {
    store().importData({ ...store(), tasks: [] });
    const mine = store().addTask({ title: 'Mine', date: today });
    store().addTask({ title: 'Example', date: today, example: true });
    store().removeExamples();
    expect(store().tasks.map((t) => t.id)).toEqual([mine]);
  });
});
