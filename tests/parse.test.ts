import { describe, expect, it } from 'vitest';
import { parseQuickAdd, unreadTokens } from '../src/lib/parse';

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
    expect(parse('Review mon').date).toBe('2026-11-23');
    expect(parse('Brunch sun').date).toBe('2026-11-22');
    expect(parse('Brunch on Sunday')).toMatchObject({ title: 'Brunch', date: '2026-11-22' });
  });

  it('sends "later" to the backlog', () => {
    expect(parse('Learn Rust later').date).toBeNull();
  });

  it('does not turn a single day word into an empty task', () => {
    expect(parse('tomorrow')).toMatchObject({ title: 'tomorrow', date: undefined });
  });

  it('leaves ordinary sentences alone', () => {
    expect(parse('Review PR #482 for auth refactor')).toMatchObject({ title: 'Review PR #482 for auth refactor', channel: null });
    expect(parse('#1 priority: ship invoice fix')).toMatchObject({ title: '#1 priority: ship invoice fix', channel: null });
    expect(parse('Prep slides for Friday')).toMatchObject({ title: 'Prep slides for Friday', date: undefined });
    expect(parse('Prep slides for tomorrow')).toMatchObject({ title: 'Prep slides for tomorrow', date: undefined });
    expect(parse('Lunch with Friday')).toMatchObject({ title: 'Lunch with Friday', date: undefined });
    expect(parse('Email him about the 2 hours')).toMatchObject({ planned: 120 });
  });

  it('reads durations written with a space or a longer unit', () => {
    expect(parse('Standup 20 min')).toMatchObject({ title: 'Standup', planned: 20 });
    expect(parse('Standup 45mins')).toMatchObject({ title: 'Standup', planned: 45 });
    expect(parse('Workshop 2 hours #work')).toMatchObject({ title: 'Workshop', planned: 120, channel: 'work' });
    expect(parse('Deep work 1.5hrs')).toMatchObject({ title: 'Deep work', planned: 90 });
  });

  it('reads a time range as a start and a length', () => {
    expect(parse('Lunch @12:30-13:30')).toMatchObject({ title: 'Lunch', start: 750, planned: 60 });
    expect(parse('Call @2-3pm')).toMatchObject({ start: 14 * 60, planned: 60 });
    expect(parse('Call @9am-10:30am 30m')).toMatchObject({ start: 540, planned: 30 });
    expect(parse('Odd @13:00-12:00').title).toBe('Odd @13:00-12:00');
  });

  it('reads the looser forms people actually type', () => {
    expect(parse('review 1h 30m')).toMatchObject({ title: 'review', planned: 90 });
    expect(parse('gym 1 h')).toMatchObject({ title: 'gym', planned: 60 });
    expect(parse('Standup @9.30')).toMatchObject({ title: 'Standup', start: 570 });
    expect(parse('Call mum @ 5pm')).toMatchObject({ title: 'Call mum', start: 17 * 60 });
    expect(parse('Lunch @noon')).toMatchObject({ title: 'Lunch', start: 12 * 60 });
  });

  it('reads "at 2pm", "@ 3 pm" and common spellings of tomorrow', () => {
    expect(parse('call bank @ 3 pm')).toMatchObject({ title: 'call bank', start: 15 * 60 });
    expect(parse('1:1 with Ana at 2pm')).toMatchObject({ title: '1:1 with Ana', start: 14 * 60 });
    expect(parse('Review at 14:30 30m')).toMatchObject({ title: 'Review', start: 870, planned: 30 });
    expect(parse('Arrive at 2 sites')).toMatchObject({ title: 'Arrive at 2 sites', start: null });
    expect(parse('Book dentist tmrw')).toMatchObject({ title: 'Book dentist', date: '2026-11-17' });
  });

  it('lets tokens sit in any order', () => {
    expect(parse('#admin 20m Expenses fri')).toMatchObject({ title: 'Expenses', planned: 20, channel: 'admin', date: '2026-11-20' });
  });
});

describe('unreadTokens', () => {
  it('points out time-like words that were not understood', () => {
    expect(unreadTokens('Odd @15:00-14:00 thing')).toEqual(['@15:00-14:00']);
    expect(unreadTokens('Ping @sam about it')).toEqual([]);
  });
});
