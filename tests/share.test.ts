import { describe, expect, it } from 'vitest';
import { decodePlan, encodePlan, isShareHash, type SharedPlan } from '../src/lib/share';

const plan: SharedPlan = {
  name: 'Zoë',
  date: '2026-11-16',
  intention: 'Ship the brief, no meetings ☀️',
  tasks: [
    { title: 'Write the launch brief', planned: 90, done: false, channel: 'deep-work', color: '#3d8fa8', start: 630 },
    { title: 'Antwoord op e-mails “snel”', planned: null, done: true, channel: null, color: null, start: null },
  ],
};

describe('share links', () => {
  it('round-trips a plan, including non-ASCII text', async () => {
    const hash = await encodePlan(plan);
    expect(isShareHash(hash)).toBe(true);
    expect(hash).toMatch(/^#plan=[zj]\.[A-Za-z0-9_-]+$/);
    expect(await decodePlan(hash)).toEqual(plan);
  });

  it('rejects anything that is not a plan', async () => {
    expect(await decodePlan('#settings')).toBeNull();
    expect(await decodePlan('#plan=z.not-really-deflate')).toBeNull();
    expect(await decodePlan('#plan=x.abc')).toBeNull();
    expect(await decodePlan(`#plan=j.${btoa(JSON.stringify({ name: 'x' }))}`)).toBeNull();
    const ascii = { name: 'Sam', date: '2026-11-16', intention: '', tasks: [] };
    expect(await decodePlan(`#plan=j.${btoa(JSON.stringify(ascii))}`)).toEqual(ascii);
    expect(await decodePlan(`#plan=j.${btoa(JSON.stringify({ ...ascii, date: '<script>' }))}`)).toBeNull();
  });
});
