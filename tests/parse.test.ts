import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../src/lib/parse';

// 2026-11-16 is a Monday.
const TODAY = '2026-11-16';
const parse = (text: string) => parseQuickAdd(text, TODAY);

describe('parseQuickAdd', () => {
  it('keeps a plain title untouched', () => {
    expect(parse('Call the dentist')).toEqual({ title: 'Call the dentist', planned: null, channel: null, date: undefined, start: null });
  });

  it('reads estimates in every supported form', () => {
    expect(parse('Write 45m').planned).toBe(45);
    expect(parse('Write 90min').planned).toBe(90);
    expect(parse('Write 1h').planned).toBe(60);
    expect(parse('Write 1h30').planned).toBe(90);
    expect(parse('Write 1h30m').planned).toBe(90);
    expect(parse('Write 1.5h').planned).toBe(90);
    expect(parse('Write 1,5h').planned).toBe(90);
  });

  it('leaves bare numbers in the title', () => {
    const p = parse('Read chapter 4');
    expect(p.title).toBe('Read chapter 4');
    expect(p.planned).toBeNull();
  });

  it('does not mistake ordinary words for durations', () => {
    expect(parse('Email him').title).toBe('Email him');
    expect(parse('Fix the 3m gap').planned).toBe(3);
    expect(parse('Review H1 numbers').title).toBe('Review H1 numbers');
  });

  it('reads a channel and a start time', () => {
    const p = parse('Write proposal 45m #work @14:30');
    expect(p).toMatchObject({ title: 'Write proposal', planned: 45, channel: 'work', start: 870 });
    expect(parse('Standup @9').start).toBe(540);
    expect(parse('Gym @6pm').start).toBe(18 * 60);
    expect(parse('Flight @12am').start).toBe(0);
  });

  it('keeps an invalid time or an email-like token in the title', () => {
    expect(parse('Ping @sam about the deck').title).toBe('Ping @sam about the deck');
    expect(parse('Odd @25:00').title).toBe('Odd @25:00');
  });

  it('reads a day word only as the last word', () => {
    expect(parse('Book flights tomorrow').date).toBe('2026-11-17');
    expect(parse('Book flights tomorrow').title).toBe('Book flights');
    expect(parse('Plan Monday offsite').date).toBeUndefined();
    expect(parse('Plan Monday offsite').title).toBe('Plan Monday offsite');
  });

  it('resolves weekdays to the next occurrence, never today', () => {
    expect(parse('Review fri').date).toBe('2026-11-20');
    expect(parse('Review on Friday').title).toBe('Review');
    expect(parse('Review monday').date).toBe('2026-11-23');
    expect(parse('Brunch sunday').date).toBe('2026-11-22');
  });

  it('sends "later" to the backlog', () => {
    expect(parse('Learn Rust later').date).toBeNull();
  });

  it('does not turn a single day word into an empty task', () => {
    expect(parse('tomorrow')).toMatchObject({ title: 'tomorrow', date: undefined });
  });

  it('lets tokens sit in any order', () => {
    expect(parse('#admin 20m Expenses fri')).toMatchObject({ title: 'Expenses', planned: 20, channel: 'admin', date: '2026-11-20' });
  });
});
