import type { ISODate } from '../types';
import { toISO } from './dates';

/**
 * Reads meetings out of an iCalendar (.ics) file, the format Google Calendar,
 * Outlook and Apple Calendar export. Handles time zones, repeating events
 * (daily, weekly, monthly, yearly, with INTERVAL, BYDAY, BYMONTHDAY, COUNT and
 * UNTIL), skipped dates (EXDATE), moved occurrences (RECURRENCE-ID) and
 * cancellations. All-day events are not meetings, so they come back apart,
 * to show on their day. Meetings the calendar's owner declined are left out.
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
  /** The zone name exactly as the file wrote it, to look up the file's own zone definitions. */
  raw?: string;
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
  /** Email addresses of attendees who said no. */
  declined: string[];
  /** Marked free (TRANSP:TRANSPARENT, or Outlook's busy status FREE): it does not take time. */
  free: boolean;
}

/** One half of a zone the file defines itself: its offset and the yearly rule for when it starts. */
interface ZoneRule {
  offset: number;
  month: number;
  /** Which weekday of the month (1 = first, -1 = last), and which weekday. */
  n: number;
  wd: number;
  h: number;
  mi: number;
}

/** Zones defined in the file being read (VTIMEZONE), for names a browser does not know. Set by readCalendar. */
let fileZones = new Map<string, { std: ZoneRule; dst?: ZoneRule }>();

const offsetMinutes = (v: string) => {
  const m = v.trim().match(/^([+-])(\d{2})(\d{2})/);
  return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
};

function readZones(all: Prop[]): Map<string, { std: ZoneRule; dst?: ZoneRule }> {
  const out = new Map<string, { std: ZoneRule; dst?: ZoneRule }>();
  let tzid: string | null = null;
  let part: 'STANDARD' | 'DAYLIGHT' | null = null;
  let rule: Partial<ZoneRule> = {};
  let found: { std?: ZoneRule; dst?: ZoneRule } = {};
  for (const p of all) {
    const v = p.value.trim().toUpperCase();
    if (p.name === 'BEGIN' && v === 'VTIMEZONE') {
      tzid = null;
      found = {};
    } else if (p.name === 'TZID' && part === null) tzid = p.value.trim();
    else if (p.name === 'BEGIN' && (v === 'STANDARD' || v === 'DAYLIGHT')) {
      part = v;
      rule = {};
    } else if (part && p.name === 'TZOFFSETTO') rule.offset = offsetMinutes(p.value);
    else if (part && p.name === 'DTSTART') {
      const m = p.value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
      if (m) {
        rule.month ??= +m[2];
        rule.h = +m[4];
        rule.mi = +m[5];
        const wd = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
        rule.wd ??= wd;
        rule.n ??= Math.ceil(+m[3] / 7);
      }
    } else if (part && p.name === 'RRULE') {
      const r = Object.fromEntries(p.value.split(';').map((x) => x.split('=') as [string, string]));
      if (r.BYMONTH) rule.month = Number(r.BYMONTH);
      const b = (r.BYDAY ?? '').match(/^([+-]?\d+)?([A-Z]{2})$/);
      if (b) {
        rule.n = b[1] ? Number(b[1]) : 1;
        rule.wd = DAYS.indexOf(b[2]);
      }
    } else if (p.name === 'END' && part && v === part) {
      const done = { offset: 0, month: 1, n: 1, wd: 0, h: 0, mi: 0, ...rule } as ZoneRule;
      if (part === 'STANDARD') found.std = done;
      else found.dst = done;
      part = null;
    } else if (p.name === 'END' && v === 'VTIMEZONE') {
      const std = found.std ?? found.dst;
      if (tzid && std) out.set(tzid, { std, dst: found.std ? found.dst : undefined });
      tzid = null;
    }
  }
  return out;
}

/** The day of the month a zone rule falls on in a year: the nth (or last) given weekday. */
function ruleDay(y: number, r: ZoneRule): number {
  const inMonth = new Date(Date.UTC(y, r.month, 0)).getUTCDate();
  if (r.n > 0) {
    const first = new Date(Date.UTC(y, r.month - 1, 1)).getUTCDay();
    return Math.min(inMonth, 1 + ((r.wd - first + 7) % 7) + (r.n - 1) * 7);
  }
  const last = new Date(Date.UTC(y, r.month - 1, inMonth)).getUTCDay();
  return inMonth - ((last - r.wd + 7) % 7) + (r.n + 1) * 7;
}

/** The offset of a zone defined in the file, at a wall-clock time. */
function fileOffset(z: { std: ZoneRule; dst?: ZoneRule }, s: Stamp): number {
  if (!z.dst) return z.std.offset;
  const key = (m: number, d: number, h: number, mi: number) => ((m * 32 + d) * 24 + h) * 60 + mi;
  const now = key(s.m, s.d, s.h, s.mi);
  const dst = key(z.dst.month, ruleDay(s.y, z.dst), z.dst.h, z.dst.mi);
  const std = key(z.std.month, ruleDay(s.y, z.std), z.std.h, z.std.mi);
  const summer = dst < std ? now >= dst && now < std : now >= dst || now < std;
  return summer ? z.dst.offset : z.std.offset;
}

/**
 * Outlook writes Windows zone names. The common ones, by the IANA name a
 * browser knows. Anything else falls back to the zone's own rules, if any, or local time.
 */
const WINDOWS_ZONES: Record<string, string> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Central Standard Time': 'America/Chicago',
  'Central America Standard Time': 'America/Guatemala',
  'Eastern Standard Time': 'America/New_York',
  'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns',
  'SA Pacific Standard Time': 'America/Bogota',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kyiv',
  'GTB Standard Time': 'Europe/Bucharest',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Egypt Standard Time': 'Africa/Cairo',
  'Russian Standard Time': 'Europe/Moscow',
  'Arabian Standard Time': 'Asia/Dubai',
  'Arab Standard Time': 'Asia/Riyadh',
  'Iran Standard Time': 'Asia/Tehran',
  'Pakistan Standard Time': 'Asia/Karachi',
  'India Standard Time': 'Asia/Kolkata',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Taipei Standard Time': 'Asia/Taipei',
  'W. Australia Standard Time': 'Australia/Perth',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'New Zealand Standard Time': 'Pacific/Auckland',
};

/** A zone name as a browser knows it: IANA names pass through, Windows names are mapped, quotes and Outlook's prefixes dropped. */
function zoneName(tz: string): string {
  const clean = tz.replace(/^"|"$/g, '').replace(/^\(UTC[^)]*\)\s*/, '').trim();
  return WINDOWS_ZONES[clean] ?? clean;
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
    tz: m[7] ? 'UTC' : p.params.TZID ? zoneName(p.params.TZID) : null,
    raw: p.params.TZID,
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
  if (first === null) {
    // Not a zone the browser knows: the file's own definition, then the "(UTC-05:00)" Outlook puts in front, then local time.
    const own = fileZones.get(s.raw ?? '') ?? fileZones.get(s.tz);
    if (own) return guess - fileOffset(own, s) * 60_000;
    const prefix = (s.raw ?? '').match(/\(UTC([+-])(\d{1,2}):?(\d{2})\)/);
    if (prefix) return guess - (prefix[1] === '-' ? -1 : 1) * (+prefix[2] * 60 + +prefix[3]) * 60_000;
    return local;
  }
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
  const all = props(text);
  fileZones = readZones(all);
  for (const p of all) {
    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VEVENT') {
      cur = { exdates: [], rrule: null, recurrenceId: null, cancelled: false, end: null, duration: null, summary: '', declined: [], free: false };
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
      else if (p.name === 'TRANSP') cur.free = cur.free || p.value.trim().toUpperCase() === 'TRANSPARENT';
      else if (p.name === 'X-MICROSOFT-CDO-BUSYSTATUS') cur.free = p.value.trim().toUpperCase() === 'FREE';
      else if (p.name === 'ATTENDEE' && (p.params.PARTSTAT ?? '').toUpperCase() === 'DECLINED')
        cur.declined!.push(p.value.replace(/^mailto:/i, '').trim().toLowerCase());
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

  // BYSETPOS picks from the days a month's rule matches, e.g. -1 with BYDAY=MO..FR is the last weekday.
  const setPos = (r.BYSETPOS ?? '').split(',').filter(Boolean).map(Number);
  const monthSets = new Map<string, number[]>();
  const fits = (t: number): boolean => {
    if (!matches(t)) return false;
    if (setPos.length === 0 || freq !== 'MONTHLY') return true;
    const c = ymd(t);
    const k = `${c.y}-${c.m}`;
    if (!monthSets.has(k)) {
      const inMonth = new Date(Date.UTC(c.y, c.m, 0)).getUTCDate();
      monthSets.set(k, Array.from({ length: inMonth }, (_, i) => i + 1).filter((d) => matches(Date.UTC(c.y, c.m - 1, d))));
    }
    const days = monthSets.get(k)!;
    const at = days.indexOf(c.d);
    return setPos.some((pos) => (pos > 0 ? at === pos - 1 : at === days.length + pos));
  };

  const out: Stamp[] = [];
  let seen = 0;
  // Day by day is simple and safe; even a weekly meeting from years back is a few thousand steps.
  for (let t = first; t <= last + 86_400_000 && seen < count; t += 86_400_000) {
    if (!fits(t)) continue;
    const c = ymd(t);
    const s: Stamp = { ...e.start, y: c.y, m: c.m, d: c.d };
    if (toEpoch(s) > untilEpoch) break;
    seen++;
    out.push(s);
  }
  return out;
}

/** What one calendar file holds for a stretch of days. */
export interface CalendarRead {
  /** The calendar's own name (Google writes the owner's email here), if the file gives one. */
  name: string | null;
  meetings: Meeting[];
  /** All-day events, such as time off or an offsite, one entry per day. */
  allDay: { date: ISODate; title: string }[];
}

/**
 * Reads the meetings in an .ics file that fall on days `from` to `to`
 * (inclusive), in this browser's time zone. Keys come from the events'
 * own UIDs, so the same calendar saved under another file name still
 * matches what is already on the board.
 */
export function readCalendar(text: string, from: ISODate, to: ISODate): CalendarRead {
  const name = props(text).find((p) => p.name === 'X-WR-CALNAME')?.value.trim() || null;
  const owner = name && name.includes('@') ? name.toLowerCase() : null;
  const all = events(text);
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const last = Date.UTC(ty, tm - 1, td, 23, 59);
  const firstLocal = new Date(fy, fm - 1, fd).getTime();
  const lastLocal = new Date(ty, tm - 1, td, 23, 59).getTime();
  // Occurrences moved or changed on their own, by event and original start.
  const moved = new Set(all.filter((e) => e.recurrenceId !== null).map((e) => `${e.uid}|${e.recurrenceId}`));
  const skipped = (e: VEvent, at: number) =>
    e.recurrenceId === null && (e.exdates.some((x) => Math.abs(x - at) < 60_000) || moved.has(`${e.uid}|${at}`));
  const meetings: Meeting[] = [];
  const allDay: { date: ISODate; title: string }[] = [];
  for (const e of all) {
    if (e.cancelled || (owner && e.declined.includes(owner))) continue;
    // A free event (focus time, a reminder) is not a meeting and takes no time; an all-day one still shows.
    if (e.free && !e.start.allDay) continue;
    if (e.start.allDay) {
      // Every day the event covers: DTEND is the day after the last one.
      const days = e.end?.allDay ? Math.max(1, Math.round((Date.UTC(e.end.y, e.end.m - 1, e.end.d) - Date.UTC(e.start.y, e.start.m - 1, e.start.d)) / 86_400_000)) : 1;
      for (const s of e.recurrenceId !== null ? [e.start] : occurrences(e, last)) {
        if (skipped(e, toEpoch(s))) continue;
        for (let i = 0; i < days; i++) {
          const date = toISO(new Date(s.y, s.m - 1, s.d + i, 12));
          if (date >= from && date <= to) allDay.push({ date, title: e.summary || 'Busy' });
        }
      }
      continue;
    }
    const startEpoch = toEpoch(e.start);
    const length =
      e.duration !== null ? e.duration : e.end && !e.end.allDay ? Math.round((toEpoch(e.end) - startEpoch) / 60_000) : 30;
    if (length <= 0 || length > 12 * 60) continue;
    const stamps = e.recurrenceId !== null ? [e.start] : occurrences(e, last);
    for (const s of stamps) {
      const at = toEpoch(s);
      if (at < firstLocal || at > lastLocal || skipped(e, at)) continue;
      const local = new Date(at);
      // A one-off event is itself, wherever it moves. One occurrence of a series is its original slot in the series.
      const repeating = e.rrule !== null || e.recurrenceId !== null;
      meetings.push({
        key: repeating ? `${e.uid}|${e.recurrenceId ?? at}` : e.uid,
        title: e.summary || 'Busy',
        date: toISO(local),
        start: local.getHours() * 60 + local.getMinutes(),
        length,
      });
    }
  }
  meetings.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start));
  return { name, meetings, allDay };
}

/** Only the meetings, for days `from` to `to`. */
export function parseCalendar(text: string, from: ISODate, to: ISODate): Meeting[] {
  return readCalendar(text, from, to).meetings;
}
