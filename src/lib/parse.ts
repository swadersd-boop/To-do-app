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

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseAtTime(token: string): number | null {
  const m = /^@(\d{1,2})(?::(\d{2}))?(am|pm)?$/i.exec(token);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const half = m[3]?.toLowerCase();
  if (half === 'pm' && h < 12) h += 12;
  if (half === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function parseDay(word: string, today: ISODate): ISODate | null | undefined {
  const w = word.toLowerCase();
  if (w === 'today') return today;
  if (w === 'tomorrow' || w === 'tmr') return addDays(today, 1);
  if (w === 'backlog' || w === 'later' || w === 'someday') return null;
  const idx = WEEKDAYS.findIndex((d) => w === d || (w.length > 3 && w.startsWith(d) && /day$/.test(w)));
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
 * as the last word, so "Plan Monday offsite" keeps its title.
 */
export function parseQuickAdd(input: string, today: ISODate): ParsedTask {
  const out: ParsedTask = { title: '', planned: null, channel: null, date: undefined, start: null };
  const kept: string[] = [];

  for (const token of input.trim().split(/\s+/).filter(Boolean)) {
    if (token.length > 1 && token.startsWith('#') && out.channel === null) {
      out.channel = token.slice(1);
      continue;
    }
    if (token.startsWith('@')) {
      const at = parseAtTime(token);
      if (at !== null && out.start === null) {
        out.start = at;
        continue;
      }
    }
    // A bare number is more likely part of the title ("Read chapter 4").
    if (out.planned === null && /[hm]/i.test(token)) {
      const dur = parseDuration(token);
      if (dur !== null && dur > 0) {
        out.planned = dur;
        continue;
      }
    }
    kept.push(token);
  }

  if (kept.length > 1) {
    const day = parseDay(kept[kept.length - 1], today);
    if (day !== undefined) {
      out.date = day;
      kept.pop();
      if (kept[kept.length - 1]?.toLowerCase() === 'on') kept.pop();
    }
  }

  out.title = kept.join(' ');
  return out;
}
