import type { ISODate } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses at local noon, so daylight saving shifts can never change the day. */
export function fromISO(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISO(now);
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((fromISO(a).getTime() - fromISO(b).getTime()) / 86_400_000);
}

/** The Monday on or before the given day. */
export function weekStart(iso: ISODate): ISODate {
  const dow = (fromISO(iso).getDay() + 6) % 7;
  return addDays(iso, -dow);
}

export function isWeekend(iso: ISODate): boolean {
  const dow = fromISO(iso).getDay();
  return dow === 0 || dow === 6;
}

export function weekdayName(iso: ISODate, style: 'short' | 'long' = 'long'): string {
  return fromISO(iso).toLocaleDateString(undefined, { weekday: style });
}

export function shortDate(iso: ISODate): string {
  return fromISO(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function longDate(iso: ISODate): string {
  return fromISO(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** "Today", "Tomorrow", "Yesterday", or the weekday name. */
export function relativeDay(iso: ISODate, today: ISODate): string {
  const d = diffDays(iso, today);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  return weekdayName(iso);
}
