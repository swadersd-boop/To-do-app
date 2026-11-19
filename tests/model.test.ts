import { describe, expect, it } from 'vitest';
import type { Task } from '../src/types';
import { estimateUsedUp, planDay, focusTarget, freeMinutes, layoutBlocks, moveTask, nextOccurrence, occursOn, rollover, tasksOn, timelineRange, workQueue } from '../src/lib/model';
import { forecast, honesty, paceOf, weekSummary, workDone, workLeft } from '../src/lib/stats';
import { addDays, diffDays, nextWorkday, relativeDay, weekStart } from '../src/lib/dates';
import { fmtClock, fmtMin, fmtStopwatch, parseDuration } from '../src/lib/time';
import { planText, shutdownText } from '../src/lib/summary';

let n = 0;
function task(patch: Partial<Task>): Task {
  n += 1;
  return {
    id: `t${n}`,
    title: `Task ${n}`,
    notes: '',
    date: '2026-11-16',
    order: 0,
    planned: null,
    actualSec: 0,
    channelId: null,
    objectiveId: null,
    done: false,
    doneAt: null,
    start: null,
    subtasks: [],
    rolled: 0,
    createdAt: '2026-11-16T08:00:00.000Z',
    ...patch,
  };
}

const ids = (list: Task[]) => list.map((t) => t.id);

describe('dates', () => {
  it('adds days across month, year and daylight saving boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-26', -2)).toBe('2026-10-24');
    expect(diffDays('2026-03-30', '2026-03-28')).toBe(2);
  });

  it('finds the Monday of a week', () => {
    expect(weekStart('2026-11-16')).toBe('2026-11-16');
    expect(weekStart('2026-11-22')).toBe('2026-11-16');
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
  });

  it('finds the next working day', () => {
    expect(nextWorkday('2026-11-18')).toBe('2026-11-19');
    expect(nextWorkday('2026-11-20')).toBe('2026-11-23');
    expect(nextWorkday('2026-11-20', true)).toBe('2026-11-21');
  });

  it('names nearby days', () => {
    expect(relativeDay('2026-11-16', '2026-11-16')).toBe('Today');
    expect(relativeDay('2026-11-17', '2026-11-16')).toBe('Tomorrow');
    expect(relativeDay('2026-11-15', '2026-11-16')).toBe('Yesterday');
  });
});

describe('time formatting', () => {
  it('formats durations and clocks', () => {
    expect(fmtMin(0)).toBe('0m');
    expect(fmtMin(45)).toBe('45m');
    expect(fmtMin(60)).toBe('1h');
    expect(fmtMin(95)).toBe('1h 35m');
    expect(fmtClock(870)).toBe('14:30');
    expect(fmtStopwatch(65)).toBe('01:05');
    expect(fmtStopwatch(3725)).toBe('1:02:05');
  });

  it('round-trips what it prints', () => {
    for (const m of [5, 45, 60, 95, 150]) expect(parseDuration(fmtMin(m).replace(/\s/g, ''))).toBe(m);
    expect(parseDuration('soon')).toBeNull();
  });
});

describe('tasksOn', () => {
  it('lists meetings first in time order, then the to-dos in the order you set', () => {
    const list = [
      task({ id: 'b', order: 0 }),
      task({ id: 'oneone', order: 1, start: 840, fixed: true }),
      task({ id: 'a', order: 2 }),
      task({ id: 'standup', order: 3, start: 570, fixed: true }),
    ];
    expect(ids(tasksOn(list, '2026-11-16'))).toEqual(['standup', 'oneone', 'b', 'a']);
  });
});

describe('moveTask', () => {
  const a = task({ id: 'a', order: 0 });
  const b = task({ id: 'b', order: 1 });
  const c = task({ id: 'c', order: 2 });
  const x = task({ id: 'x', date: '2026-11-17', order: 0 });

  it('reorders within a day', () => {
    expect(ids(tasksOn(moveTask([a, b, c, x], 'c', '2026-11-16', 0), '2026-11-16'))).toEqual(['c', 'a', 'b']);
    expect(ids(tasksOn(moveTask([a, b, c, x], 'a', '2026-11-16', 2), '2026-11-16'))).toEqual(['b', 'c', 'a']);
  });

  it('moves to another day at a position', () => {
    const out = moveTask([a, b, c, x], 'b', '2026-11-17', 0);
    expect(ids(tasksOn(out, '2026-11-17'))).toEqual(['b', 'x']);
    expect(ids(tasksOn(out, '2026-11-16'))).toEqual(['a', 'c']);
  });

  it('drops the timebox when the day changes, keeps it otherwise', () => {
    const boxed = task({ id: 'boxed', order: 3, start: 600 });
    expect(moveTask([a, boxed, x], 'boxed', '2026-11-17', 5).find((t) => t.id === 'boxed')!.start).toBeNull();
    expect(moveTask([a, boxed, x], 'boxed', '2026-11-16', 0).find((t) => t.id === 'boxed')!.start).toBe(600);
  });

  it('moves to the backlog and clamps wild indexes', () => {
    const out = moveTask([a, b, c], 'a', null, 99);
    expect(ids(tasksOn(out, null))).toEqual(['a']);
    expect(moveTask([a], 'missing', null, 0)).toEqual([a]);
  });
});

describe('rollover', () => {
  it('carries unfinished past tasks to today after what is already there, oldest first', () => {
    const old = task({ id: 'old', date: '2026-11-13', order: 4, start: 540 });
    const yesterday = task({ id: 'yesterday', date: '2026-11-15', order: 0 });
    const finished = task({ id: 'finished', date: '2026-11-15', order: 1, done: true });
    const today = task({ id: 'today', date: '2026-11-16', order: 0 });
    const later = task({ id: 'later', date: null, order: 0 });
    const out = rollover([today, finished, yesterday, old, later], '2026-11-16');

    expect(ids(tasksOn(out, '2026-11-16'))).toEqual(['today', 'old', 'yesterday']);
    expect(out.find((t) => t.id === 'old')).toMatchObject({ rolled: 1, start: null });
    expect(out.find((t) => t.id === 'finished')!.date).toBe('2026-11-15');
    expect(out.find((t) => t.id === 'later')!.date).toBeNull();
  });

  it('returns the same array when there is nothing to carry', () => {
    const list = [task({ date: '2026-11-16' }), task({ date: '2026-11-15', done: true })];
    expect(rollover(list, '2026-11-16')).toBe(list);
  });
});

describe('fixed commitments', () => {
  it('keep their time when moved to another day, and lose it in the backlog', () => {
    const meeting = task({ id: 'm', start: 840, fixed: true });
    expect(moveTask([meeting], 'm', '2026-11-18', 0)[0]).toMatchObject({ date: '2026-11-18', start: 840, fixed: true });
    expect(moveTask([meeting], 'm', null, 0)[0]).toMatchObject({ date: null, start: null, fixed: false });
  });

  it('do not roll over', () => {
    const missed = task({ id: 'missed', date: '2026-11-15', start: 1200, fixed: true });
    const todo = task({ id: 'todo', date: '2026-11-15' });
    const out = rollover([missed, todo], '2026-11-16');
    expect(out.find((t) => t.id === 'missed')!.date).toBe('2026-11-15');
    expect(out.find((t) => t.id === 'todo')!.date).toBe('2026-11-16');
  });
});

describe('timelineRange', () => {
  it('stretches to show early and late timeboxes', () => {
    const day = [task({ start: 450, planned: 30 }), task({ start: 20 * 60, planned: 90 }), task({})];
    expect(timelineRange(day, 8, 19)).toEqual({ start: 7, end: 22 });
    expect(timelineRange([task({ start: 600 })], 8, 19)).toEqual({ start: 8, end: 19 });
  });
});

describe('occursOn', () => {
  const standup = task({ date: '2026-11-16', repeat: 'weekdays', repeatFrom: '2026-11-16' });
  it('previews a repeating task on the days it will come up', () => {
    expect(occursOn(standup, '2026-11-16')).toBe(false);
    expect(occursOn(standup, '2026-11-17')).toBe(true);
    expect(occursOn(standup, '2026-11-21')).toBe(false);
    expect(occursOn({ ...standup, repeat: 'weekly' }, '2026-11-23')).toBe(true);
    expect(occursOn({ ...standup, repeat: 'weekly' }, '2026-11-24')).toBe(false);
    expect(occursOn({ ...standup, done: true }, '2026-11-17')).toBe(false);
    expect(occursOn(task({}), '2026-11-17')).toBe(false);
  });
});

describe('layoutBlocks', () => {
  it('gives overlapping blocks their own columns', () => {
    const out = layoutBlocks([
      { id: 'a', start: 540, end: 600 },
      { id: 'b', start: 570, end: 630 },
      { id: 'c', start: 700, end: 730 },
    ]);
    expect(out.a).toEqual({ col: 0, cols: 2 });
    expect(out.b).toEqual({ col: 1, cols: 2 });
    expect(out.c).toEqual({ col: 0, cols: 1 });
  });

  it('treats back-to-back blocks as not overlapping', () => {
    const out = layoutBlocks([
      { id: 'a', start: 540, end: 600 },
      { id: 'b', start: 600, end: 630 },
    ]);
    expect(out.a.cols).toBe(1);
    expect(out.b.cols).toBe(1);
  });
});

describe('estimate honesty', () => {
  const finished = (planned: number, actualMin: number, channelId: string | null = null) =>
    task({ done: true, planned, actualSec: actualMin * 60, channelId });

  it('stays silent without enough history', () => {
    expect(honesty([finished(30, 45), finished(30, 45), finished(30, 45), finished(30, 45)]).overall).toBeNull();
    expect(forecast([task({ planned: 60 })], [])).toBeNull();
  });

  it('ignores tasks that were never tracked or never estimated', () => {
    const list = [finished(30, 45), finished(30, 45), task({ done: true, planned: 30 }), task({ done: true, actualSec: 900 })];
    expect(honesty(list).overall).toBeNull();
  });

  // Five tasks in "deep" that each ran 50% over, and one admin task that took half its estimate.
  const history = () => [
    finished(60, 90, 'deep'),
    finished(30, 45, 'deep'),
    finished(30, 45, 'deep'),
    finished(20, 30, 'deep'),
    finished(40, 60, 'deep'),
    finished(30, 15, 'admin'),
  ];

  it('measures the overall and per-channel ratio', () => {
    const h = honesty(history());
    expect(h.overall).toEqual({ ratio: 285 / 210, samples: 6 });
    expect(h.byChannel.deep.ratio).toBeCloseTo(1.5);
    expect(h.byChannel.admin).toBeUndefined();
  });

  it('forecasts with the channel ratio first, the overall one second', () => {
    const plan = [task({ planned: 60, channelId: 'deep' }), task({ planned: 100, channelId: 'admin' }), task({})];
    expect(forecast(plan, history())).toBeCloseTo(60 * 1.5 + 100 * (285 / 210));
  });
});

describe('summaries', () => {
  const channels = [{ id: 'w', name: 'work', color: '#000' }];

  it('writes the plan as text', () => {
    const text = planText('2026-11-16', [task({ title: 'Brief', planned: 90, channelId: 'w' }), task({ title: 'Emails' })], channels, ' Ship it ');
    expect(text).toContain('Focus: Ship it');
    expect(text).toContain('1. Brief (1h 30m) #work');
    expect(text).toContain('2. Emails');
    // Emails has no estimate, so like the timeline the total books the usual half hour for it.
    expect(text.endsWith('Work: 2h')).toBe(true);
  });

  it('totals the work the same way as its lines, and names a task past its estimate', () => {
    const tasks = [task({ title: 'Memo', planned: 120, actualSec: 25 * 60, channelId: 'w' }), task({ title: 'Research', planned: 60, actualSec: 70 * 60 })];
    const text = planText('2026-11-16', tasks, channels, '', (t) => (t.channelId === 'w' ? 1.5 : 1));
    expect(text).toContain('1. Memo (1h 35m left of 2h) #work');
    expect(text).toContain('2. Research (past its 1h estimate)');
    // Research has no estimate of what is left, so nothing is made up for it in the total.
    expect(text).toContain('Work: 1h 35m by your estimates, about 2h 25m at your pace');
  });

  it('names the time worked today on tasks that are not done', () => {
    const recap = shutdownText('2026-11-16', [task({ title: 'Write report', planned: 180, actualSec: 235 * 60 })], channels, '');
    expect(recap).toContain('- Write report: 3h 55m worked');
  });

  it('says where time on work put off to a later day went', () => {
    const recap = shutdownText('2026-11-17', [], channels, '', undefined, { carriedSec: 79 * 60, carriedTitles: ['Prep slides'], carriedWork: [{ title: 'Prep slides', sec: 79 * 60 }] });
    expect(recap).toContain('Moved to a later day (1):\n- Prep slides: 1h 19m worked');
    expect(recap).toContain('Worked 1h 19m.');
    expect(recap).not.toContain('Nothing was planned');
  });

  it('says what is left of a started task, and what was done before today', () => {
    const plan = planText('2026-11-16', [task({ title: 'Tax return', planned: 180, actualSec: 120 * 60 })], channels, '');
    expect(plan).toContain('1. Tax return (1h left of 3h)');
    const recap = shutdownText(
      '2026-11-16',
      [task({ title: 'Onboarding', planned: 120, actualSec: 125 * 60, trackedBefore: 85 * 60, done: true })],
      channels,
      '',
    );
    expect(recap).toContain('- Onboarding: 40m today, 2h 5m in all (planned 2h)');
  });

  it('writes the recap as text', () => {
    const text = shutdownText(
      '2026-11-16',
      [task({ title: 'Brief', planned: 90, actualSec: 3000, done: true }), task({ title: 'Emails', planned: 30 })],
      channels,
      'Good day',
    );
    expect(text).toContain('Done (1):\n- Brief: 50m (planned 1h 30m)');
    expect(text).toContain('Not done (1):\n- Emails');
    expect(text).toContain('Worked 50m. 30m of work left undone.');
    expect(text).toContain('Reflection: Good day');
  });
});

describe('nextOccurrence', () => {
  it('repeats daily from the day after', () => {
    expect(nextOccurrence('daily', '2026-11-16', '2026-11-16')).toBe('2026-11-17');
    expect(nextOccurrence('daily', '2026-11-13', '2026-11-16')).toBe('2026-11-17');
  });

  it('skips the weekend for weekday tasks', () => {
    expect(nextOccurrence('weekdays', '2026-11-20', '2026-11-20')).toBe('2026-11-23');
    expect(nextOccurrence('weekdays', '2026-11-18', '2026-11-18')).toBe('2026-11-19');
  });

  it('keeps a weekly task on its weekday, even when finished late', () => {
    expect(nextOccurrence('weekly', '2026-11-16', '2026-11-16')).toBe('2026-11-23');
    expect(nextOccurrence('weekly', '2026-11-16', '2026-11-18')).toBe('2026-11-23');
    expect(nextOccurrence('weekly', '2026-11-16', '2026-11-25')).toBe('2026-11-30');
  });
});

describe('what to work on now', () => {
  const day = [
    task({ id: 'standup', order: 0, planned: 15, start: 570, fixed: true }),
    task({ id: 'proposal', order: 1, planned: 120, start: 780 }),
    task({ id: 'one-on-one', order: 2, planned: 30, start: 840, fixed: true }),
    task({ id: 'dinner', order: 3, planned: 90, start: 1200, fixed: true }),
    task({ id: 'emails', order: 4, planned: 20 }),
    task({ id: 'finished', order: 5, done: true, start: 540 }),
  ];

  it('follows the timeline and leaves out what is over', () => {
    expect(workQueue(day, 690).map((t) => t.id)).toEqual(['proposal', 'one-on-one', 'dinner', 'emails']);
  });

  it('orders a split task by its next block, not by the part already behind it', () => {
    const memo = task({ id: 'memo', order: 0, planned: 120, start: 540, parts: [{ start: 800, length: 30 }] });
    const review = task({ id: 'review', order: 1, planned: 60, start: 700 });
    expect(workQueue([memo, review], 690).map((t) => t.id)).toEqual(['review', 'memo']);
  });

  it('puts work that is behind first', () => {
    const legal = task({ id: 'legal', order: 1, planned: 30, start: 600 });
    const budget = task({ id: 'budget', order: 2, planned: 60, start: 780 });
    // At 11:40 the 10:00 reply is overdue, so it comes before the 13:00 budget review.
    expect(focusTarget([legal, budget], 700)!.id).toBe('legal');
  });

  it('never picks a meeting to focus on', () => {
    expect(focusTarget(day, 690)!.id).toBe('proposal');
    const onlyMeetings = day.filter((t) => t.fixed || t.done);
    expect(focusTarget(onlyMeetings, 690)).toBeNull();
    expect(focusTarget(onlyMeetings, 845)).toBeNull();
  });
});

describe('freeMinutes', () => {
  it('subtracts commitments and breaks from the time that is left', () => {
    const day = [task({ start: 840, planned: 30, fixed: true }), task({ start: 600, planned: 60 })];
    expect(freeMinutes(day, 690, 19 * 60, [{ start: 720, end: 780 }])).toBe(450 - 60 - 30);
    expect(freeMinutes([], 1110, 19 * 60)).toBe(30);
    expect(freeMinutes([], 1200, 19 * 60)).toBe(0);
  });
});

describe('weekSummary', () => {
  it('counts what was still open at the end from the last working day on, each task once', () => {
    const mon = '2026-11-16';
    const days = {
      '2026-11-19': { carried: 2, carriedTitles: ['A', 'B'] },
      '2026-11-20': { carried: 8, carriedTitles: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] },
      '2026-11-21': { carried: 1, carriedTitles: ['Buy groceries'] },
    };
    expect(weekSummary([], days, [], mon).leftOver).toBe(9);
  });

  it('counts each task once and reports what was left at the end of the week', () => {
    const mon = '2026-11-09';
    const tasks = [
      task({ date: '2026-11-09', done: true, actualSec: 3600 }),
      task({ date: '2026-11-11', done: true, actualSec: 1800 }),
      task({ date: '2026-11-12', done: true, fixed: true, start: 570 }),
      task({ date: '2026-11-16', done: false }),
    ];
    const days = { '2026-11-10': { carried: 1, carriedSec: 600 }, '2026-11-11': { carried: 1 }, '2026-11-13': { carried: 2, carriedSec: 0 } };
    const objectives = [{ weekStart: mon, done: true }, { weekStart: mon, done: false }, { weekStart: '2026-11-16', done: false }];
    expect(weekSummary(tasks, days, objectives, mon)).toEqual({ start: mon, done: 2, tracked: 100, leftOver: 2, objectivesDone: 1, objectives: 2 });
  });
});

describe('paceOf', () => {
  it('scales by channel, falls back to the overall pace, and stays within limits', () => {
    const done = (planned: number, actualMin: number, channelId: string | null) => task({ done: true, planned, actualSec: actualMin * 60, channelId });
    const history = [...Array(5)].map(() => done(60, 90, 'deep')).concat([...Array(5)].map(() => done(60, 60, 'admin')));
    const pace = paceOf(history)!;
    expect(pace(task({ channelId: 'deep' }))).toBeCloseTo(1.5);
    expect(pace(task({ channelId: 'admin' }))).toBeCloseTo(1);
    expect(pace(task({ channelId: null }))).toBeCloseTo(1.25);
    expect(paceOf([])).toBeNull();
    const wild = [...Array(5)].map(() => done(10, 100, 'x'));
    expect(paceOf(wild)!(task({ channelId: 'x' }))).toBe(2);
  });
});

describe('planDay: one stream in priority order', () => {
  const lunch = [{ start: 720, end: 780 }];
  const standup = task({ id: 'standup', order: 0, planned: 15, start: 570, fixed: true });
  const spans = (p: { blocks: { start: number; end: number }[] } | null | undefined) => p?.blocks.map((b) => [b.start, b.end]) ?? null;

  it('lays tasks out one after another in list order, pausing for meetings and lunch', () => {
    const hiring = task({ id: 'hiring', order: 1, planned: 120 });
    const email = task({ id: 'email', order: 2, planned: 30 });
    const review = task({ id: 'review', order: 3, planned: 45 });
    const plan = planDay([standup, hiring, email, review], 520, 19 * 60, lunch);
    // 08:40-09:30, standup, 09:45-10:55: two hours. Then the email. The review does not fit
    // in the 35 minutes before lunch and is too short to split, so it waits for 13:00.
    expect(spans(plan.hiring)).toEqual([[520, 570], [585, 655]]);
    expect(spans(plan.email)).toEqual([[655, 685]]);
    expect(spans(plan.review)).toEqual([[780, 825]]);
  });

  it('never lets a lower task jump ahead of a higher one', () => {
    const deep = task({ id: 'deep', order: 1, planned: 50 });
    const quick = task({ id: 'quick', order: 2, planned: 20 });
    const plan = planDay([standup, deep, quick], 525, 19 * 60, lunch);
    // 45 minutes before the standup are not enough for the 50-minute top task; the quick one does not take them.
    expect(spans(plan.deep)).toEqual([[585, 635]]);
    expect(spans(plan.quick)).toEqual([[635, 655]]);
  });

  it('splits a long task at a meeting into two long blocks, not scraps', () => {
    const hiring = task({ id: 'hiring', order: 1, planned: 120 });
    expect(spans(planDay([standup, hiring], 525, 19 * 60, lunch).hiring)).toEqual([[525, 570], [585, 660]]);
  });

  it('leaves no piece shorter than half an hour', () => {
    // 20 minutes before the standup are too short a piece; the task starts after it.
    const hiring = task({ id: 'hiring', order: 1, planned: 120 });
    expect(spans(planDay([standup, hiring], 550, 19 * 60, lunch).hiring)).toEqual([[585, 705]]);
    // A tail under half an hour is avoided by ending the first piece earlier.
    const report = task({ id: 'report', order: 1, planned: 70 });
    expect(spans(planDay([standup, report], 520, 19 * 60, lunch).report)).toEqual([[520, 560], [585, 615]]);
  });

  it('starts at the next five minutes, not the next quarter hour', () => {
    expect(spans(planDay([task({ id: 'a', planned: 30 })], 871, 19 * 60).a)).toEqual([[875, 905]]);
  });

  it('keeps the worked part of a paused task and plans the rest from now', () => {
    const memo = task({ id: 'memo', planned: 120, start: 585, actualSec: 115 * 60 });
    expect(spans(planDay([memo], 910, 19 * 60, lunch).memo)).toEqual([[585, 705], [910, 925]]);
  });

  it('joins work that carries straight on from the part already done', () => {
    const brief = task({ id: 'brief', planned: 60, start: 660, actualSec: 20 * 60 });
    expect(spans(planDay([brief], 690, 19 * 60).brief)).toEqual([[660, 730]]);
  });

  it('books what fits of a long task and lets the bottom of the list drop off', () => {
    // The afternoon has two hours; the five-hour task gets them, and the smaller task below it waits.
    const big = task({ id: 'big', order: 0, planned: 300 });
    const small = task({ id: 'small', order: 1, planned: 60 });
    const plan = planDay([big, small], 17 * 60, 19 * 60);
    expect(spans(plan.big)).toEqual([[1020, 1140]]);
    expect(plan.big!.partial).toBe(true);
    expect(plan.small).toBeNull();
  });

  it('fills the capacity that is left instead of dropping the long task (the critic\'s Tuesday)', () => {
    const top = task({ id: 'top', order: 0, planned: 120 });
    const blog = task({ id: 'blog', order: 1, planned: 180 });
    const offsite = task({ id: 'offsite', order: 2, planned: 60 });
    // 4h 30m of capacity: the top task's 2h, then 2h 30m of the 3h blog post; the offsite drops off.
    const plan = planDay([top, blog, offsite], 540, 19 * 60, [], 270);
    expect(spans(plan.top)).toEqual([[540, 660]]);
    expect(spans(plan.blog)).toEqual([[660, 810]]);
    expect(plan.blog!.partial).toBe(true);
    expect(plan.offsite).toBeNull();
  });

  it('never books a scrap under half an hour of a long task', () => {
    const plan = planDay([task({ id: 'big', planned: 120 })], 18 * 60 + 40, 19 * 60);
    expect(plan.big).toBeNull();
  });

  it('stops at the budget, and plans at the given pace', () => {
    // With half an hour of capacity left, an hour-long task gets that half hour today.
    expect(planDay([task({ id: 'x', planned: 60 })], 540, 19 * 60, [], 30).x).toEqual({ blocks: [{ start: 540, end: 570 }], partial: true, need: 60 });
    expect(planDay([task({ id: 'y', planned: 60 })], 540, 19 * 60, [], 25).y).toBeNull();
    const deep = task({ id: 'deep', order: 0, planned: 60, channelId: 'deep' });
    const next = task({ id: 'next', order: 1, planned: 30 });
    const plan = planDay([deep, next], 540, 19 * 60, [], Number.POSITIVE_INFINITY, (t) => (t.channelId === 'deep' ? 1.5 : 1));
    expect(spans(plan.deep)).toEqual([[540, 630]]);
    expect(spans(plan.next)).toEqual([[630, 660]]);
  });

  it('works around finished work and never moves fixed commitments', () => {
    const done = task({ id: 'done', order: 0, planned: 30, start: 540, done: true });
    const later = task({ id: 'later', order: 1, planned: 30 });
    const plan = planDay([done, standup, later], 540, 19 * 60);
    expect(plan.done).toBeUndefined();
    expect(plan.standup).toBeUndefined();
    // Finished work holds 09:00-09:30 and the standup 09:30-09:45, so the task starts at 09:45.
    expect(spans(plan.later)).toEqual([[585, 615]]);
  });

  it('books nothing for a task past its estimate until it has a new one, and carries on with the rest', () => {
    const over = task({ id: 'over', planned: 60, actualSec: 70 * 60 });
    const next = task({ id: 'next', planned: 30 });
    expect(estimateUsedUp(over)).toBe(true);
    const plan = planDay([over, next], 540, 19 * 60);
    expect(plan.over).toBeNull();
    expect(spans(plan.next)).toEqual([[540, 570]]);
    // And it adds nothing made up to the work left.
    expect(workLeft([over, next])).toBe(30);
  });

  it('says how much a partly booked task needs in all', () => {
    const plan = planDay([task({ id: 'big', planned: 240 })], 540, 19 * 60, [], 120);
    expect(plan.big).toMatchObject({ partial: true, need: 240 });
  });
});

describe('work done and work left', () => {
  it('counts a task ticked off without the timer by the block it kept, the same on every screen', () => {
    // Finished at 10:00 in a block that started 09:45: the block shrank to the 15 minutes it took.
    const invoice = task({ planned: 30, done: true, start: 585, blockMin: 15 });
    // Finished before its block came up: no block, so what was left of the estimate.
    const early = task({ planned: 20, done: true });
    expect(workDone([invoice, early])).toBe(15 + 20);
  });

  it('counts time worked today, or the estimate of a task finished without the timer', () => {
    const day = [
      task({ planned: 120, actualSec: 128 * 60, trackedBefore: 95 * 60, done: true }),
      task({ planned: 60, done: true }),
      task({ planned: 60, actualSec: 20 * 60 }),
      task({ planned: 30, start: 570, fixed: true, done: true }),
    ];
    expect(workDone(day)).toBe(33 + 60 + 20);
  });

  it('counts only what was left of a task finished today without the timer', () => {
    // 25 minutes were worked on an earlier day; finishing it today accounts for the other 1h 35m.
    expect(workDone([task({ planned: 120, actualSec: 25 * 60, trackedBefore: 25 * 60, done: true })])).toBe(95);
  });

  it('counts what open to-dos still need, at the given pace', () => {
    const day = [task({ planned: 60, actualSec: 20 * 60 }), task({ planned: 30, channelId: 'deep' }), task({ planned: 30, done: true }), task({ planned: 15, fixed: true })];
    expect(workLeft(day)).toBe(40 + 30);
    expect(workLeft(day, (t) => (t.channelId === 'deep' ? 2 : 1))).toBe(40 + 60);
  });
});
