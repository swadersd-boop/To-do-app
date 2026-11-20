import { describe, expect, it } from 'vitest';
import { timerAsk } from '../src/components/bits';
import type { Task } from '../src/types';

const task = (patch: Partial<Task>): Task =>
  ({ id: 't', title: 'Design onboarding', date: '2026-11-16', planned: 120, actualSec: 0, start: null, fixed: false, done: false, ...patch }) as Task;

describe('timerAsk', () => {
  it('counts time logged before this run when deciding to ask', () => {
    // Today, so the overnight question does not apply.
    const at11 = new Date();
    at11.setHours(11, 0, 0, 0);
    const startedAt = at11.getTime();
    // Two and a half hours were logged earlier on a 2h task: the check comes half an hour into this run, not three hours.
    const ask = timerAsk({ taskId: 't', startedAt }, task({ actualSec: 150 * 60 }), []);
    expect((ask.at - startedAt) / 60_000).toBe(30);
    const fresh = timerAsk({ taskId: 't', startedAt }, task({}), []);
    expect((fresh.at - startedAt) / 60_000).toBe(180);
  });

  it('offers to stop at lunch for a timer that ran on through it', () => {
    const at11 = new Date();
    at11.setHours(11, 21, 0, 0);
    const lunch = new Date(at11);
    lunch.setHours(12, 0, 0, 0);
    // A 1h30 task: the check comes at 13:36, and the stop it offers is the start of lunch.
    const ask = timerAsk({ taskId: 't', startedAt: at11.getTime() }, task({ planned: 90 }), []);
    expect(ask.stopAt).toBe(lunch.getTime());
  });
});
