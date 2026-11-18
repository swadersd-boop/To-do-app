import { describe, expect, it } from 'vitest';
import type { Task } from '../src/types';
import { autoSchedule, freeGaps, planLength, remainingOf, focusTarget, freeMinutes, layoutBlocks, moveTask, nextOccurrence, occursOn, rollover, tasksOn, timelineRange, workQueue } from '../src/lib/model';
import { forecast, honesty, paceOf, weekSummary } from '../src/lib/stats';
import { addDays, diffDays, relativeDay, weekStart } from '../src/lib/dates';
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

describe('autoSchedule', () => {
  it('places tasks in list order around fixed commitments and breaks', () => {
    const day = [
      task({ id: 'a', order: 0, planned: 90 }),
      task({ id: 'meeting', order: 1, planned: 45, start: 585, fixed: true }),
      task({ id: 'b', order: 2, planned: 25 }),
      task({ id: 'done', order: 3, planned: 30, done: true, start: 480 }),
      task({ id: 'c', order: 4 }),
    ];
    // Priority picks first, but a short task further down still uses the gap before the meeting.
    expect(autoSchedule(day, 550, 19 * 60, [{ start: 720, end: 780 }])).toEqual({ a: 630, b: 555, c: 780 });
  });

  it('leaves out what does not fit before the end of the day', () => {
    const day = [task({ id: 'big', order: 0, planned: 240 }), task({ id: 'small', order: 1, planned: 30 })];
    expect(autoSchedule(day, 17 * 60, 19 * 60)).toEqual({ big: null, small: 17 * 60 });
  });

  it('never overlaps anything it places', () => {
    const day = Array.from({ length: 8 }, (_, i) => task({ id: `k${i}`, order: i, planned: 10 + i * 13 }));
    const placed = autoSchedule(day, 8 * 60, 22 * 60);
    const spans = day.map((t) => [placed[t.id]!, placed[t.id]! + t.planned!]).sort((p, q) => p[0] - q[0]);
    for (let i = 1; i < spans.length; i += 1) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);
  });
});

describe('fixed commitments', () => {
  it('are never moved by scheduling, and flexible tasks flow around them', () => {
    const day = [
      task({ id: 'standup', order: 0, planned: 15, start: 570, fixed: true }),
      task({ id: 'slipped', order: 1, planned: 60, start: 540 }),
      task({ id: 'ahead', order: 2, planned: 30, start: 900 }),
      task({ id: 'loose', order: 3, planned: 45 }),
      task({ id: 'one-on-one', order: 4, planned: 30, start: 840, fixed: true }),
    ];
    // It is 11:30: everything flexible is laid out again from now, in list order.
    expect(autoSchedule(day, 690, 19 * 60)).toEqual({ slipped: 690, ahead: 750, loose: 780 });
  });

  it('books only the time a half-done task still needs', () => {
    const deck = task({ id: 'deck', order: 0, planned: 120, actualSec: 104 * 60, start: 540 });
    expect(remainingOf(deck)).toBe(20);
    // The work it already got stays where it happened, and the block runs on for the 20 minutes left.
    expect(autoSchedule([deck], 690, 19 * 60, [{ start: 720, end: 780 }])).toEqual({ deck: 540 });
    expect(planLength(deck, 690)).toBe(690 - 540 + 20);
    // A half-done task that was planned for later is simply moved with what it still needs.
    const later = { ...deck, start: 900 };
    expect(autoSchedule([later], 690, 19 * 60, [{ start: 720, end: 780 }])).toEqual({ deck: 690 });
    expect(planLength(later, 690)).toBe(20);
  });

  it("stops at the day's capacity even when the clock has room", () => {
    const day = [task({ id: 'a', order: 0, planned: 240 }), task({ id: 'b', order: 1, planned: 120 }), task({ id: 'c', order: 2, planned: 60 })];
    expect(autoSchedule(day, 480, 19 * 60, [], 300)).toEqual({ a: 480, b: null, c: 720 });
  });

  it('when running late, keeps the top priority and drops the bottom of the list', () => {
    const day = [
      task({ id: 'proposal', order: 0, planned: 120, start: 540 }),
      task({ id: 'review', order: 1, planned: 60, start: 660 }),
      task({ id: 'refactor', order: 2, planned: 180, start: 1080 }),
      task({ id: 'one-on-one', order: 3, planned: 30, start: 840, fixed: true }),
    ];
    const plan = autoSchedule(day, 690, 19 * 60, [{ start: 720, end: 780 }]);
    // Two hours do not fit between lunch and the 14:00 one-to-one, so it starts after it,
    // and the shorter review takes the gap instead of leaving it empty.
    expect(plan.proposal).toBe(870);
    expect(plan.review).toBe(780);
    expect(plan.refactor).toBeNull();
  });

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
    expect(text.endsWith('Total: 1h 30m')).toBe(true);
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
    expect(text).toContain('Tracked 50m against 2h of work planned.');
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

  it('never focuses on a meeting that has not started', () => {
    expect(focusTarget(day, 690)!.id).toBe('proposal');
    const onlyMeetingsAhead = day.filter((t) => t.id !== 'proposal' && t.id !== 'emails');
    expect(focusTarget(onlyMeetingsAhead, 690)).toBeNull();
    expect(focusTarget(onlyMeetingsAhead, 838)!.id).toBe('one-on-one');
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

describe('replanning keeps worked time in place', () => {
  it('leaves a task in progress where it started and only extends it', () => {
    // Worked from 13:00, already 2h30m in on a 2h estimate, replanned at 15:30.
    const memo = task({ id: 'memo', order: 0, planned: 120, start: 780, actualSec: 150 * 60 });
    const offsite = task({ id: 'offsite', order: 1, planned: 60 });
    const plan = autoSchedule([memo, offsite], 930, 19 * 60);
    expect(plan.memo).toBe(780);
    expect(planLength(memo, 930)).toBe(150 + 15);
    expect(plan.offsite).toBe(945);
  });

  it('still moves a task that was planned earlier but never started', () => {
    const slipped = task({ id: 'slipped', planned: 60, start: 600 });
    expect(autoSchedule([slipped], 690, 19 * 60)).toEqual({ slipped: 690 });
    expect(planLength(slipped, 690)).toBe(60);
  });

  it('can plan at the pace history shows', () => {
    const deep = task({ id: 'deep', planned: 60, channelId: 'deep' });
    const plan = autoSchedule([deep, task({ id: 'next', order: 1, planned: 30 })], 540, 19 * 60, [], Number.POSITIVE_INFINITY, (t) => (t.channelId === 'deep' ? 1.5 : 1));
    expect(plan).toEqual({ deep: 540, next: 630 });
    expect(planLength(deep, 540, () => 1.5)).toBe(90);
  });
});

describe('weekSummary', () => {
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

describe('freeGaps', () => {
  it('lists every free stretch of at least the minimum length', () => {
    const day = [task({ start: 570, planned: 15, fixed: true }), task({ start: 900, planned: 60 })];
    // Finished work counts as taken: from 08:40 the first free stretch starts at 09:00.
    const withDone = [...day, task({ start: 520, planned: 20, done: true })];
    expect(freeGaps(withDone, 520, 19 * 60, [{ start: 720, end: 780 }], 30)[0]).toEqual({ start: 540, length: 30 });
    expect(freeGaps(day, 525, 19 * 60, [{ start: 720, end: 780 }], 30)).toEqual([
      { start: 525, length: 45 },
      { start: 585, length: 135 },
      { start: 780, length: 360 },
    ]);
  });
});
