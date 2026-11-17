import type { ISODate } from '../types';
import { addDays, fromISO } from './dates';
import { parseDuration } from './time';

export interface ParsedTask {
  title: string;
  planned: number | null;
  /** Channel name as typed after `#`, without the hash. */
  channel: string | null;
  /** `undefined` = nothing typed, `null` = backlog. */
  date: ISODate | null | undefined;
  /** Minutes from midnight. */
  start: number | null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** After one of these, a day word belongs to the sentence: "Prep slides for Friday". */
const NOT_A_DATE_AFTER = new Set(['for', 'by', 'before', 'until', 'till', 'about', 'this', 'next', 'last', 'every', 'of', 'the']);
const UNIT_WORD = /^(minutes?|mins?|m|hours?|hrs?|h)$/i;
const MINUTES_ONLY = /^(\d{1,2})(?:m|mins?|minutes?)$/i;
const CLOCK = String.raw`(\d{1,2})(?:[:.](\d{2}))?(am|pm)?`;
const AT_TIME = new RegExp(`^@${CLOCK}(?:-${CLOCK})?$`, 'i');

function clock(hour: string, minute: string | undefined, half: string | undefined): number | null {
  let h = Number(hour);
  const min = Number(minute ?? 0);
  const ampm = half?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** "@14:30", "@9.30", "@2pm", "@noon" or a range like "@12:30-13:30". */
function parseAtTime(token: string): { start: number; length: number | null } | null {
  if (/^@noon$/i.test(token)) return { start: 12 * 60, length: null };
  const m = AT_TIME.exec(token);
  if (!m) return null;
  // In "2-3pm" the start borrows the "pm"; in "11-1pm" it does not.
  const startHalf = m[3] ?? (m[6] && Number(m[1]) < Number(m[4]) ? m[6] : undefined);
  const start = clock(m[1], m[2], startHalf);
  if (start === null) return null;
  if (m[4] === undefined) return { start, length: null };
  const end = clock(m[4], m[5], m[6] ?? (m[3] && Number(m[4]) < 12 ? m[3] : undefined));
  if (end === null || end <= start) return null;
  return { start, length: end - start };
}

function parseDay(word: string, before: string | undefined, today: ISODate): ISODate | null | undefined {
  const w = word.toLowerCase();
  const prev = before?.toLowerCase();
  if (prev && NOT_A_DATE_AFTER.has(prev)) return undefined;
  if (w === 'today') return today;
  if (w === 'tomorrow' || w === 'tmr') return addDays(today, 1);
  if (w === 'backlog' || w === 'later' || w === 'someday') return null;
  // "fri" is shorthand nobody types by accident. A full "Friday" needs "on" in front.
  const idx = WEEKDAYS.findIndex((d) => (w.length === 3 && d.startsWith(w)) || (w === d && prev === 'on'));
  if (idx === -1) return undefined;
  const ahead = (idx - fromISO(today).getDay() + 7) % 7 || 7;
  return addDays(today, ahead);
}

/**
 * Turns one line of text into a task.
 *
 *   "Write proposal 45m #work @14:30 tomorrow"
 *
 * Durations, `#channel` and `@time` can sit anywhere. A day word only counts
 * as the last word, so "Plan Monday offsite" keeps its title. Anything that
 * could be part of a normal sentence ("PR #482", "for Friday") is left alone.
 */
export function parseQuickAdd(input: string, today: ISODate): ParsedTask {
  const out: ParsedTask = { title: '', planned: null, channel: null, date: undefined, start: null };
  const kept: string[] = [];
  // "@ 5pm" is the same as "@5pm".
  const tokens = input.trim().replace(/(^|\s)@\s+(?=\d|noon)/gi, '$1@').split(/\s+/).filter(Boolean);
  let rangeLength: number | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    // A channel starts with a letter, so "#482" and "#1" stay in the title.
    if (out.channel === null && /^#\p{L}[\p{L}\p{N}_-]*$/u.test(token)) {
      out.channel = token.slice(1);
      continue;
    }
    if (token.startsWith('@') && out.start === null) {
      const at = parseAtTime(token);
      if (at) {
        out.start = at.start;
        rangeLength = at.length;
        continue;
      }
    }
    if (out.planned === null) {
      // "20 min": a number followed by a unit word.
      if (/^\d+(?:[.,]\d+)?$/.test(token) && UNIT_WORD.test(tokens[i + 1] ?? '')) {
        const dur = parseDuration(token + tokens[i + 1]);
        if (dur !== null && dur > 0) {
          out.planned = dur;
          i += 1;
          continue;
        }
      }
      // A bare number is more likely part of the title ("Read chapter 4").
      if (/^\d/.test(token) && /[a-z]/i.test(token)) {
        const dur = parseDuration(token);
        if (dur !== null && dur > 0) {
          out.planned = dur;
          // "1h 30m" written as two words.
          const rest = MINUTES_ONLY.exec(tokens[i + 1] ?? '');
          if (rest && /h/i.test(token) && !/\d[m]/i.test(token.replace(/^[\d.,]+h(?:ours?|rs?)?/i, ''))) {
            out.planned += Number(rest[1]);
            i += 1;
          }
          continue;
        }
      }
    }
    kept.push(token);
  }

  if (out.planned === null) out.planned = rangeLength;

  if (kept.length > 1) {
    const day = parseDay(kept[kept.length - 1], kept[kept.length - 2], today);
    if (day !== undefined) {
      out.date = day;
      kept.pop();
      if (kept.length > 1 && kept[kept.length - 1].toLowerCase() === 'on') kept.pop();
    }
  }

  out.title = kept.join(' ');
  return out;
}

/** Words that look like they were meant as a time or duration but could not be read. */
export function unreadTokens(title: string): string[] {
  return title.split(/\s+/).filter((w) => /^@\S/.test(w) && !/^@\p{L}+$/u.test(w));
}
