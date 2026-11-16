import { describe, expect, it } from 'vitest';
import type { Task } from '../src/types';
import { autoSchedule, layoutBlocks, moveTask, rollover, tasksOn } from '../src/lib/model';
import { forecast, honesty } from '../src/lib/stats';
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
  it('carries unfinished past tasks to the top of today, oldest first', () => {
    const old = task({ id: 'old', date: '2026-11-13', order: 4, start: 540 });
    const yesterday = task({ id: 'yesterday', date: '2026-11-15', order: 0 });
    const finished = task({ id: 'finished', date: '2026-11-15', order: 1, done: true });
    const today = task({ id: 'today', date: '2026-11-16', order: 0 });
    const later = task({ id: 'later', date: null, order: 0 });
    const out = rollover([today, finished, yesterday, old, later], '2026-11-16');

    expect(ids(tasksOn(out, '2026-11-16'))).toEqual(['old', 'yesterday', 'today']);
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
  it('places tasks in order around existing timeboxes', () => {
    const day = [
      task({ id: 'a', order: 0, planned: 90 }),
      task({ id: 'meeting', order: 1, planned: 45, start: 585 }),
      task({ id: 'b', order: 2, planned: 25 }),
      task({ id: 'done', order: 3, planned: 30, done: true }),
      task({ id: 'c', order: 4 }),
    ];
    expect(autoSchedule(day, 550, 19 * 60)).toEqual({ a: 630, b: 720, c: 750 });
  });

  it('leaves out what does not fit before the end of the day', () => {
    const day = [task({ id: 'big', order: 0, planned: 240 }), task({ id: 'small', order: 1, planned: 30 })];
    expect(autoSchedule(day, 17 * 60, 19 * 60)).toEqual({ small: 17 * 60 });
  });

  it('never overlaps anything it places', () => {
    const day = Array.from({ length: 8 }, (_, i) => task({ id: `k${i}`, order: i, planned: 10 + i * 13 }));
    const placed = autoSchedule(day, 8 * 60, 22 * 60);
    const spans = day.map((t) => [placed[t.id], placed[t.id] + t.planned!]).sort((p, q) => p[0] - q[0]);
    for (let i = 1; i < spans.length; i += 1) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);
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
    expect(honesty([finished(30, 45), finished(30, 45)]).overall).toBeNull();
    expect(forecast([task({ planned: 60 })], [])).toBeNull();
  });

  it('ignores tasks that were never tracked or never estimated', () => {
    const list = [finished(30, 45), finished(30, 45), task({ done: true, planned: 30 }), task({ done: true, actualSec: 900 })];
    expect(honesty(list).overall).toBeNull();
  });

  it('measures the overall and per-channel ratio', () => {
    const list = [finished(60, 90, 'deep'), finished(30, 45, 'deep'), finished(30, 45, 'deep'), finished(30, 15, 'admin')];
    const h = honesty(list);
    expect(h.overall).toEqual({ ratio: 195 / 150, samples: 4 });
    expect(h.byChannel.deep.ratio).toBeCloseTo(1.5);
    expect(h.byChannel.admin).toBeUndefined();
  });

  it('forecasts with the channel ratio first, the overall one second', () => {
    const history = [finished(60, 90, 'deep'), finished(30, 45, 'deep'), finished(30, 45, 'deep'), finished(30, 15, 'admin')];
    const plan = [task({ planned: 60, channelId: 'deep' }), task({ planned: 100, channelId: 'admin' }), task({})];
    expect(forecast(plan, history)).toBeCloseTo(60 * 1.5 + 100 * 1.3);
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
    expect(text).toContain('Tracked 50m against 2h planned.');
    expect(text).toContain('Reflection: Good day');
  });
});
