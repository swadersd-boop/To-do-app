import { describe, expect, it } from 'vitest';
import { parseCalendar } from '../src/lib/ics';
import { toISO } from '../src/lib/dates';

// Expectations go through this machine's own time zone, so the tests pass wherever they run.
const local = (utc: number) => {
  const d = new Date(utc);
  return { date: toISO(d), start: d.getHours() * 60 + d.getMinutes() };
};

const cal = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...events, 'END:VCALENDAR'].join('\r\n');

const standup = [
  'BEGIN:VEVENT',
  'UID:standup@example.com',
  'SUMMARY:Standup',
  'DTSTART;TZID=Europe/Amsterdam:20261102T093000',
  'DTEND;TZID=Europe/Amsterdam:20261102T094500',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  'EXDATE;TZID=Europe/Amsterdam:20261118T093000',
  'BEGIN:VALARM',
  'TRIGGER:-PT10M',
  'ACTION:DISPLAY',
  'DESCRIPTION:Reminder',
  'END:VALARM',
  'END:VEVENT',
].join('\r\n');

describe('parseCalendar', () => {
  it('expands a repeating meeting in its own time zone, skipping a removed date', () => {
    const meetings = parseCalendar(cal(standup), '2026-11-16', '2026-11-22');
    // Amsterdam is UTC+1 in November: 09:30 there is 08:30 UTC.
    expect(meetings.map((m) => m.date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-19', '2026-11-20'].map((d) => local(Date.parse(`${d}T08:30:00Z`)).date));
    expect(meetings[0]).toMatchObject({ title: 'Standup', length: 15, ...local(Date.UTC(2026, 10, 16, 8, 30)) });
    expect(new Set(meetings.map((m) => m.key)).size).toBe(4);
  });

  it('uses a moved occurrence instead of the original, and drops a cancelled one', () => {
    const moved = [
      'BEGIN:VEVENT',
      'UID:standup@example.com',
      'RECURRENCE-ID;TZID=Europe/Amsterdam:20261117T093000',
      'SUMMARY:Standup (moved)',
      'DTSTART;TZID=Europe/Amsterdam:20261117T110000',
      'DTEND;TZID=Europe/Amsterdam:20261117T111500',
      'END:VEVENT',
    ].join('\r\n');
    const cancelled = [
      'BEGIN:VEVENT',
      'UID:standup@example.com',
      'RECURRENCE-ID;TZID=Europe/Amsterdam:20261119T093000',
      'STATUS:CANCELLED',
      'DTSTART;TZID=Europe/Amsterdam:20261119T093000',
      'END:VEVENT',
    ].join('\r\n');
    const meetings = parseCalendar(cal(standup, moved, cancelled), '2026-11-16', '2026-11-20');
    expect(meetings.map((m) => m.title)).toEqual(['Standup', 'Standup (moved)', 'Standup']);
    expect(meetings[1]).toMatchObject(local(Date.UTC(2026, 10, 17, 10, 0)));
  });

  it('reads UTC times, durations, folded lines and escaped text, and leaves out all-day events', () => {
    const text = cal(
      ['BEGIN:VEVENT', 'UID:a', 'SUMMARY:Client call\\, Acme', 'DTSTART:20261116T130000Z', 'DURATION:PT1H30M', 'END:VEVENT'].join('\r\n'),
      ['BEGIN:VEVENT', 'UID:b', 'SUMMARY:Offsite', 'DTSTART;VALUE=DATE:20261117', 'DTEND;VALUE=DATE:20261118', 'END:VEVENT'].join('\r\n'),
      ['BEGIN:VEVENT', 'UID:c', 'SUMMARY:A very long', '  title', 'DTSTART:20261118T100000', 'DTEND:20261118T103000', 'END:VEVENT'].join('\r\n'),
    );
    const meetings = parseCalendar(text, '2026-11-16', '2026-11-22');
    expect(meetings.map((m) => m.title)).toEqual(['Client call, Acme', 'A very long title']);
    expect(meetings[0]).toMatchObject({ length: 90, ...local(Date.UTC(2026, 10, 16, 13, 0)) });
    // A one-off event keeps its key when it moves, so a second import updates it.
    const later = parseCalendar(text.replace('DTSTART:20261116T130000Z', 'DTSTART:20261117T150000Z'), '2026-11-16', '2026-11-22');
    expect(later.find((m) => m.title === 'Client call, Acme')!.key).toBe(meetings[0].key);
    // No zone given: the time is read as local time.
    expect(meetings[1]).toMatchObject({ date: '2026-11-18', start: 600, length: 30 });
  });

  it('stops a series at COUNT or UNTIL and handles intervals and monthly rules', () => {
    const text = cal(
      ['BEGIN:VEVENT', 'UID:count', 'SUMMARY:Three times', 'DTSTART:20261116T090000', 'DTEND:20261116T100000', 'RRULE:FREQ=DAILY;COUNT=3', 'END:VEVENT'].join('\r\n'),
      ['BEGIN:VEVENT', 'UID:fortnight', 'SUMMARY:Every other week', 'DTSTART:20261102T140000', 'DTEND:20261102T150000', 'RRULE:FREQ=WEEKLY;INTERVAL=2', 'END:VEVENT'].join('\r\n'),
      ['BEGIN:VEVENT', 'UID:monthly', 'SUMMARY:Third Thursday', 'DTSTART:20261015T160000', 'DTEND:20261015T163000', 'RRULE:FREQ=MONTHLY;BYDAY=3TH', 'END:VEVENT'].join('\r\n'),
      ['BEGIN:VEVENT', 'UID:until', 'SUMMARY:Until Tuesday', 'DTSTART:20261110T080000', 'DTEND:20261110T081500', 'RRULE:FREQ=DAILY;UNTIL=20261117T235959', 'END:VEVENT'].join('\r\n'),
    );
    const meetings = parseCalendar(text, '2026-11-16', '2026-11-30');
    const on = (title: string) => meetings.filter((m) => m.title === title).map((m) => m.date);
    expect(on('Three times')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18']);
    expect(on('Every other week')).toEqual(['2026-11-16', '2026-11-30']);
    expect(on('Third Thursday')).toEqual(['2026-11-19']);
    expect(on('Until Tuesday')).toEqual(['2026-11-16', '2026-11-17']);
  });
});
