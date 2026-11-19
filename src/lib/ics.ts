import type { ISODate } from '../types';
import { toISO } from './dates';

/**
 * Reads meetings out of an iCalendar (.ics) file, the format Google Calendar,
 * Outlook and Apple Calendar export. Handles time zones, repeating events
 * (daily, weekly, monthly, yearly, with INTERVAL, BYDAY, BYMONTHDAY, COUNT and
 * UNTIL), skipped dates (EXDATE), moved occurrences (RECURRENCE-ID) and
 * cancellations. All-day events are left out: they are not meetings.
 */

export interface Meeting {
  /** Stable for one occurrence of one event, so a second import updates rather than duplicates. */
  key: string;
  title: string;
  date: ISODate;
  /** Minutes from local midnight. */
  start: number;
  /** Minutes. */
  length: number;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface Stamp {
  /** Wall-clock parts as written in the file. */
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  /** Time zone name, 'UTC', or null for floating (local) time. */
  tz: string | null;
  allDay: boolean;
}

interface VEvent {
  uid: string;
  summary: string;
  start: Stamp;
  end: Stamp | null;
  duration: number | null;
  rrule: Record<string, string> | null;
  exdates: number[];
  recurrenceId: number | null;
  cancelled: boolean;
}

/** Joins folded lines and splits each into name, parameters and value. */
function props(text: string): Prop[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  return lines
    .filter((l) => l.includes(':'))
    .map((line) => {
      // The value starts at the first colon that is not inside a quoted parameter.
      let quoted = false;
      let at = -1;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') quoted = !quoted;
        if (line[i] === ':' && !quoted) {
          at = i;
          break;
        }
      }
      const head = line.slice(0, at);
      const value = line.slice(at + 1);
      const [name, ...rest] = head.split(';');
      const params: Record<string, string> = {};
      for (const p of rest) {
        const eq = p.indexOf('=');
        if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
      }
      return { name: name.toUpperCase(), params, value };
    });
}

const unescape = (s: string) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

function stamp(p: Prop, value = p.value): Stamp | null {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const allDay = p.params.VALUE === 'DATE' || m[4] === undefined;
  return {
    y: +m[1],
    m: +m[2],
    d: +m[3],
    h: allDay ? 0 : +m[4],
    mi: allDay ? 0 : +m[5],
    tz: m[7] ? 'UTC' : (p.params.TZID ?? null),
    allDay,
  };
}

/** Minutes a zone is ahead of UTC at an instant, or null for a zone this browser does not know. */
function zoneOffset(epoch: number, tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(epoch));
    const get = (type: string) => Number(parts.find((x) => x.type === type)?.value);
    const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
    return Math.round((asUTC - Math.floor(epoch / 60_000) * 60_000) / 60_000);
  } catch {
    return null;
  }
}

/** The instant a wall-clock time stands for. Unknown zones (some Outlook names) are read as local time. */
function toEpoch(s: Stamp): number {
  if (s.tz === 'UTC') return Date.UTC(s.y, s.m - 1, s.d, s.h, s.mi);
  const local = new Date(s.y, s.m - 1, s.d, s.h, s.mi).getTime();
  if (s.tz === null) return local;
  const guess = Date.UTC(s.y, s.m - 1, s.d, s.h, s.mi);
  const first = zoneOffset(guess, s.tz);
  if (first === null) return local;
  const at = guess - first * 60_000;
  // Once more, in case the guess fell on the other side of a daylight saving change.
  const second = zoneOffset(at, s.tz) ?? first;
  return guess - second * 60_000;
}

function duration(value: string): number | null {
  const m = value.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  return (+(m[2] ?? 0) * 7 * 1440 + +(m[3] ?? 0) * 1440 + +(m[4] ?? 0) * 60 + +(m[5] ?? 0)) * (m[1] === '-' ? -1 : 1);
}

function events(text: string): VEvent[] {
  const out: VEvent[] = [];
  let cur: Partial<VEvent> | null = null;
  let depth = 0;
  for (const p of props(text)) {
    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VEVENT') {
      cur = { exdates: [], rrule: null, recurrenceId: null, cancelled: false, end: null, duration: null, summary: '' };
      depth = 0;
      continue;
    }
    if (!cur) continue;
    // Alarms and other parts inside an event have their own properties; skip them.
    if (p.name === 'BEGIN') depth++;
    else if (p.name === 'END' && p.value.toUpperCase() !== 'VEVENT') depth--;
    else if (p.name === 'END') {
      if (cur.uid && cur.start) out.push(cur as VEvent);
      cur = null;
    } else if (depth === 0) {
      if (p.name === 'UID') cur.uid = p.value.trim();
      else if (p.name === 'SUMMARY') cur.summary = unescape(p.value);
      else if (p.name === 'DTSTART') cur.start = stamp(p) ?? undefined;
      else if (p.name === 'DTEND') cur.end = stamp(p);
      else if (p.name === 'DURATION') cur.duration = duration(p.value.trim());
      else if (p.name === 'STATUS') cur.cancelled = p.value.trim().toUpperCase() === 'CANCELLED';
      else if (p.name === 'RRULE') cur.rrule = Object.fromEntries(p.value.split(';').map((x) => x.split('=') as [string, string]).map(([k, v]) => [k.toUpperCase(), v]));
      else if (p.name === 'EXDATE')
        for (const v of p.value.split(',')) {
          const s = stamp(p, v);
          if (s) cur.exdates!.push(toEpoch(s));
        }
      else if (p.name === 'RECURRENCE-ID') {
        const s = stamp(p);
        if (s) cur.recurrenceId = toEpoch(s);
      }
    }
  }
  return out;
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const ymd = (t: number) => {
  const d = new Date(t);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay() };
};

/** The wall-clock dates (in the event's own zone) on which a repeating event falls, up to `last`. */
function occurrences(e: VEvent, last: number): Stamp[] {
  const first = Date.UTC(e.start.y, e.start.m - 1, e.start.d);
  if (!e.rrule) return [e.start];
  const r = e.rrule;
  const freq = r.FREQ;
  const interval = Math.max(1, Number(r.INTERVAL ?? 1));
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? stamp({ name: 'UNTIL', params: {}, value: r.UNTIL }) : null;
  const untilEpoch = until ? (until.allDay ? Date.UTC(until.y, until.m - 1, until.d, 23, 59) : toEpoch(until)) : Infinity;
  const byDay = (r.BYDAY ?? '').split(',').filter(Boolean).map((x) => {
    const m = x.match(/^([+-]?\d+)?([A-Z]{2})$/);
    return m ? { n: m[1] ? Number(m[1]) : null, wd: DAYS.indexOf(m[2]) } : null;
  }).filter((x): x is { n: number | null; wd: number } => x !== null);
  const byMonthDay = (r.BYMONTHDAY ?? '').split(',').filter(Boolean).map(Number);
  const startDay = ymd(first);
  const weekOf = (t: number) => Math.floor((t - ((ymd(t).wd + 6) % 7) * 86_400_000 - (first - ((startDay.wd + 6) % 7) * 86_400_000)) / (7 * 86_400_000));

  const matches = (t: number): boolean => {
    const c = ymd(t);
    const days = Math.round((t - first) / 86_400_000);
    if (freq === 'DAILY') return days % interval === 0 && (byDay.length === 0 || byDay.some((b) => b.wd === c.wd));
    if (freq === 'WEEKLY') {
      const wds = byDay.length > 0 ? byDay.map((b) => b.wd) : [startDay.wd];
      return weekOf(t) % interval === 0 && wds.includes(c.wd);
    }
    if (freq === 'MONTHLY') {
      const months = (c.y - startDay.y) * 12 + (c.m - startDay.m);
      if (months % interval !== 0) return false;
      if (byMonthDay.length > 0) {
        const inMonth = new Date(Date.UTC(c.y, c.m, 0)).getUTCDate();
        return byMonthDay.some((n) => (n > 0 ? n : inMonth + n + 1) === c.d);
      }
      if (byDay.length > 0) {
        const inMonth = new Date(Date.UTC(c.y, c.m, 0)).getUTCDate();
        const nth = Math.ceil(c.d / 7);
        const fromEnd = -Math.ceil((inMonth - c.d + 1) / 7);
        return byDay.some((b) => b.wd === c.wd && (b.n === null || b.n === nth || b.n === fromEnd));
      }
      return c.d === startDay.d;
    }
    if (freq === 'YEARLY') return (c.y - startDay.y) % interval === 0 && c.m === startDay.m && c.d === startDay.d;
    return days === 0;
  };

  const out: Stamp[] = [];
  let seen = 0;
  // Day by day is simple and safe; even a weekly meeting from years back is a few thousand steps.
  for (let t = first; t <= last + 86_400_000 && seen < count; t += 86_400_000) {
    if (!matches(t)) continue;
    const c = ymd(t);
    const s: Stamp = { ...e.start, y: c.y, m: c.m, d: c.d };
    if (toEpoch(s) > untilEpoch) break;
    seen++;
    out.push(s);
  }
  return out;
}

/**
 * The meetings in an .ics file that fall on days `from` to `to` (inclusive),
 * in this browser's time zone. `source` names the calendar, so meetings from
 * two calendars never replace each other.
 */
export function parseCalendar(text: string, from: ISODate, to: ISODate, source = 'calendar'): Meeting[] {
  const all = events(text);
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const last = Date.UTC(ty, tm - 1, td, 23, 59);
  const firstLocal = new Date(fy, fm - 1, fd).getTime();
  const lastLocal = new Date(ty, tm - 1, td, 23, 59).getTime();
  // Occurrences moved or changed on their own, by event and original start.
  const moved = new Set(all.filter((e) => e.recurrenceId !== null).map((e) => `${e.uid}|${e.recurrenceId}`));
  const out: Meeting[] = [];
  for (const e of all) {
    if (e.start.allDay || e.cancelled) continue;
    const startEpoch = toEpoch(e.start);
    const length =
      e.duration !== null ? e.duration : e.end && !e.end.allDay ? Math.round((toEpoch(e.end) - startEpoch) / 60_000) : 30;
    if (length <= 0 || length > 12 * 60) continue;
    const stamps = e.recurrenceId !== null ? [e.start] : occurrences(e, last);
    for (const s of stamps) {
      const at = toEpoch(s);
      if (at < firstLocal || at > lastLocal) continue;
      if (e.recurrenceId === null && (e.exdates.some((x) => Math.abs(x - at) < 60_000) || moved.has(`${e.uid}|${at}`))) continue;
      const local = new Date(at);
      // A one-off event is itself, wherever it moves. One occurrence of a series is its original slot in the series.
      const repeating = e.rrule !== null || e.recurrenceId !== null;
      out.push({
        key: repeating ? `${source}|${e.uid}|${e.recurrenceId ?? at}` : `${source}|${e.uid}`,
        title: e.summary || 'Busy',
        date: toISO(local),
        start: local.getHours() * 60 + local.getMinutes(),
        length,
      });
    }
  }
  // A moved occurrence that was then cancelled leaves nothing; the rest by time.
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start));
}
