import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SESSION_SEC, useStore } from '../src/store';
import { addDays, todayISO, weekStart } from '../src/lib/dates';
import { estimateUsedUp, needOf, sessionsOn, tasksOn } from '../src/lib/model';
import { workDone } from '../src/lib/stats';

const today = todayISO();
const yesterday = addDays(today, -1);
const store = () => useStore.getState();
const find = (id: string) => store().tasks.find((t) => t.id === id)!;
const read = (meetings: { key: string; title: string; date: string; start: number; length: number }[]) => ({ name: null, meetings, allDay: [] });

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

  it('does not make up when the work happened for time typed in by hand', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 16, 17, 31));
    const day = todayISO();
    const id = store().addTask({ title: 'Plan team offsite', date: day, planned: 60, start: 15 * 60 + 45 });
    store().updateTask(id, { actualSec: 70 * 60 });
    store().toggleDone(id);
    // There is no timer record of when it was done, so the planned block stays as it was.
    expect(find(id)).toMatchObject({ start: 15 * 60 + 45, actualSec: 70 * 60 });
    expect(find(id).blockMin ?? null).toBeNull();
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

  it('never parks work for an open objective of this week', () => {
    store().addObjective('Ship the pricing memo', weekStart(today));
    const objective = store().objectives[0];
    const id = store().addTask({ title: 'Draft pricing memo', date: yesterday, planned: 60 });
    store().updateTask(id, { rolled: 5, objectiveId: objective.id });
    store().rollover(today);
    expect(find(id).date).toBe(today);
    expect(store().defer(id, addDays(today, 1))).toBe('day');
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

  it('records each timer run as a session, and finishing keeps them as they were', () => {
    vi.useFakeTimers();
    const at = (h: number, m: number) => vi.setSystemTime(new Date(2026, 10, 16, h, m));
    at(8, 0);
    const day = todayISO();
    const id = store().addTask({ title: 'Memo', date: day, planned: 120, start: 9 * 60 });
    for (const [from, to] of [[[9, 0], [9, 50]], [[11, 0], [12, 0]], [[13, 0], [13, 45]]] as const) {
      at(from[0], from[1]);
      store().startTimer(id);
      at(to[0], to[1]);
      store().stopTimer();
    }
    expect(sessionsOn(find(id), day)).toEqual([
      { start: 540, end: 590 },
      { start: 660, end: 720 },
      { start: 780, end: 825 },
    ]);
    at(14, 45);
    store().toggleDone(id);
    // No block is made up: the task starts where the work started, and the sessions stay three.
    expect(find(id)).toMatchObject({ done: true, start: 540, parts: null });
    expect(sessionsOn(find(id), day)).toHaveLength(3);
  });

  it('keeps time worked today on today when the task is put off or moved', () => {
    vi.useFakeTimers();
    const at = (h: number, m: number) => vi.setSystemTime(new Date(2026, 10, 17, h, m));
    at(10, 30);
    const day = todayISO();
    const next = addDays(day, 1);
    const slides = store().addTask({ title: 'Prep slides', date: day, planned: 120 });
    const memo = store().addTask({ title: 'Memo', date: day, planned: 60 });
    const done = store().addTask({ title: 'Done', date: day, planned: 30 });
    store().startTimer(slides);
    at(11, 49);
    store().stopTimer();
    store().startTimer(memo);
    at(12, 19);
    store().stopTimer();
    store().startTimer(done);
    at(12, 49);
    store().toggleDone(done);
    const workedToday = () => workDone(tasksOn(store().tasks, day), store().days[day]);
    expect(workedToday()).toBe(79 + 30 + 30);

    store().defer(slides, next);
    store().moveTask(memo, null, 0);
    // The time stays where it happened, and nothing is counted twice on the next day.
    expect(workedToday()).toBe(139);
    expect(workDone(tasksOn(store().tasks, next), store().days[next])).toBe(0);
    expect(store().days[day]).toMatchObject({ carried: 1, carriedTitles: ['Prep slides'] });
    expect(store().days[day].carriedSec).toBe((79 + 30) * 60);
  });

  it('counts a timer left running overnight on the day it started', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 23, 17, 0));
    const monday = todayISO();
    const id = store().addTask({ title: 'Quick fix', date: monday, planned: 30 });
    store().startTimer(id);
    vi.setSystemTime(new Date(2026, 10, 24, 8, 30));
    const tuesday = todayISO();
    store().rollover(tuesday);
    store().stopTimer(new Date(2026, 10, 23, 18, 0).getTime());
    expect(find(id).date).toBe(tuesday);
    expect(workDone(tasksOn(store().tasks, tuesday), store().days[tuesday])).toBe(0);
    expect(workDone(tasksOn(store().tasks, monday), store().days[monday])).toBe(60);
  });

  it('does not lose a task to a stray second of tracked time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 16, 16, 30));
    const day = todayISO();
    store().setSettings({ capacityMin: 360, dayEnd: 19 });
    const report = store().addTask({ title: 'Report', date: day, planned: 330 });
    store().updateTask(report, { actualSec: 330 * 60 + 1, done: true });
    const id = store().addTask({ title: 'Design', date: day, planned: 30 });
    const { left } = store().autoSchedule(day, 16 * 60 + 30);
    expect(left).toHaveLength(0);
    expect(find(id).start).toBe(16 * 60 + 30);
  });

  it('keeps the original estimate when you say how much is left', () => {
    const id = store().addTask({ title: 'Write report', date: today, planned: 180 });
    store().updateTask(id, { actualSec: 230 * 60 });
    expect(estimateUsedUp(find(id))).toBe(true);
    store().setLeft(id, 60);
    // The estimate stays 3h for Insights and the recap; the plan books the hour you said, not more.
    expect(find(id).planned).toBe(180);
    expect(estimateUsedUp(find(id))).toBe(false);
    expect(needOf(find(id), () => 1.5)).toBe(60);
    store().updateTask(id, { actualSec: 260 * 60 });
    expect(needOf(find(id))).toBe(30);
    // A new estimate replaces the answer.
    store().updateTask(id, { planned: 300 });
    expect(find(id).left ?? null).toBeNull();
  });

  it('never books the night: an overnight timer stopped without a time ends at the end of the working day', () => {
    vi.useFakeTimers();
    store().setSettings({ dayEnd: 19 });
    vi.setSystemTime(new Date(2026, 10, 23, 17, 5));
    const id = store().addTask({ title: 'Write report', date: todayISO(), planned: 180 });
    store().startTimer(id);
    vi.setSystemTime(new Date(2026, 10, 24, 8, 30));
    store().stopTimer();
    expect(find(id).actualSec).toBe((19 * 60 - (17 * 60 + 5)) * 60);
    // Started after the working day: nothing is booked without asking.
    vi.setSystemTime(new Date(2026, 10, 24, 21, 0));
    store().startTimer(id);
    vi.setSystemTime(new Date(2026, 10, 25, 8, 0));
    store().startTimer(id);
    expect(find(id).actualSec).toBe((19 * 60 - (17 * 60 + 5)) * 60);
  });

  it('matches a calendar saved under another file name instead of adding it twice', () => {
    const m = [{ key: 'standup-uid|1', title: 'Standup', date: today, start: 660, length: 15 }];
    store().importCalendar(read(m), today, today, 'basic', 'basic.ics');
    expect(store().importCalendar(read(m), today, today, 'basic (1)', 'basic (1).ics')).toMatchObject({ added: 0 });
    expect(store().tasks.filter((t) => t.title === 'Standup')).toHaveLength(1);
    // And cancelling it in the second file removes it, wherever it came from first.
    expect(store().importCalendar(read([{ key: 'other|1', title: 'Other', date: today, start: 700, length: 15 }]), today, today, 'basic (1)', 'x.ics').removed).toBe(0);
  });

  it('brings back a meeting that was counted as held but moved to later in the calendar', () => {
    const d1 = addDays(today, -1);
    const m = { key: 'one|slot', title: '1:1 with Marieke', date: d1, start: 930, length: 30 };
    store().importCalendar(read([m]), d1, today, 'work', 'work.ics');
    store().settleCommitments(today, 600);
    expect(store().tasks.find((t) => t.title === '1:1 with Marieke')!.done).toBe(true);
    const moved = { ...m, date: addDays(today, 1), start: 630 };
    expect(store().importCalendar(read([moved]), today, addDays(today, 1), 'work', 'work.ics').updated).toBe(1);
    expect(store().tasks.find((t) => t.title === '1:1 with Marieke')).toMatchObject({ done: false, date: addDays(today, 1), start: 630 });
  });

  it('lets the calendar take over a repeating meeting typed into Kalm, and keeps all-day events on their day', () => {
    const typed = store().addTask({ title: 'Standup', date: today, planned: 15, start: 570, fixed: true });
    store().updateTask(typed, { repeat: 'weekdays', repeatFrom: today });
    const m = [{ key: 'su|1', title: 'Standup', date: today, start: 660, length: 15 }];
    const result = store().importCalendar({ name: null, meetings: m, allDay: [{ date: addDays(today, 1), title: 'Out of office' }] }, today, addDays(today, 1), 'work', 'work.ics');
    expect(result.replaced).toEqual(['Standup']);
    expect(store().tasks.filter((t) => t.title === 'Standup' && !t.done)).toEqual([expect.objectContaining({ start: 660, calendarKey: 'su|1' })]);
    expect(store().days[addDays(today, 1)].allDay).toEqual([{ title: 'Out of office', cal: 'work' }]);
  });

  it('imports calendar meetings once, updates them, and removes ones that were cancelled', () => {
    const d1 = today;
    const d2 = addDays(today, 1);
    const typed = store().addTask({ title: 'Standup', date: d1, planned: 15, start: 570, fixed: true });
    const first = [
      { key: 'work|standup|1', title: 'Standup', date: d1, start: 570, length: 15 },
      { key: 'work|call|1', title: 'Client call', date: d1, start: 840, length: 60 },
      { key: 'work|review|1', title: 'Review', date: d2, start: 600, length: 30 },
    ];
    expect(store().importCalendar(read(first), d1, d2, 'work', 'work.ics')).toEqual({ added: 2, updated: 0, removed: 0, replaced: [] });
    // The standup typed by hand is linked, not copied.
    expect(store().tasks.filter((t) => t.title === 'Standup')).toHaveLength(1);
    expect(find(typed).calendarKey).toBe('work|standup|1');
    // Importing the same file again changes nothing.
    expect(store().importCalendar(read(first), d1, d2, 'work', 'work.ics')).toEqual({ added: 0, updated: 0, removed: 0, replaced: [] });
    // The call moved to 15:00 and the review was cancelled.
    const second = [first[0], { ...first[1], start: 900 }];
    expect(store().importCalendar(read(second), d1, d2, 'work', 'work.ics')).toEqual({ added: 0, updated: 1, removed: 1, replaced: [] });
    expect(store().tasks.find((t) => t.title === 'Client call')).toMatchObject({ start: 900, fixed: true, planned: 60 });
    expect(store().tasks.some((t) => t.title === 'Review')).toBe(false);
    expect(store().settings.calendarImport?.name).toBe('work.ics');
  });

  it('replans around work already done, without erasing it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 16, 9, 0));
    const day = todayISO();
    store().setSettings({ lunchStart: null, planAtPace: false });
    const memo = store().addTask({ title: 'Memo', date: day, planned: 120, start: 540 });
    store().startTimer(memo);
    vi.setSystemTime(new Date(2026, 10, 16, 10, 0));
    store().stopTimer();
    store().autoSchedule(day, 11 * 60 + 30);
    // The hour worked stays recorded; the hour left is planned from now.
    expect(sessionsOn(find(memo), day)).toEqual([{ start: 540, end: 600 }]);
    expect(find(memo)).toMatchObject({ start: 690, blockMin: 60 });
  });

  it('does not count a task created today as moved on when the plan moves it', () => {
    const fresh = store().addTask({ title: 'Blog post', date: today, planned: 180 });
    const old = store().addTask({ title: 'Old one', date: today, planned: 60 });
    store().updateTask(old, { createdAt: '2026-01-01T09:00:00.000Z' });
    store().defer(fresh, addDays(today, 1), { counts: false });
    store().defer(old, addDays(today, 1));
    expect(find(fresh).rolled).toBe(0);
    expect(find(old).rolled).toBe(1);
  });

  it('removes only the example tasks', () => {
    store().importData({ ...store(), tasks: [] });
    const mine = store().addTask({ title: 'Mine', date: today });
    store().addTask({ title: 'Example', date: today, example: true });
    store().removeExamples();
    expect(store().tasks.map((t) => t.id)).toEqual([mine]);
  });
});
