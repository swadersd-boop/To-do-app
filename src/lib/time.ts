/** 95 -> "1h 35m", 60 -> "1h", 20 -> "20m", 0 -> "0m". */
export function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/** Minutes from midnight -> "14:30". */
export function fmtClock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Seconds -> "1:02:09" or "12:09". */
export function fmtStopwatch(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "14:30" -> 870, or null when the text is not a time. */
export function parseClock(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Reads a typed duration ("45", "45m", "45mins", "1h", "1hr", "1h30", "1.5h") as minutes. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const hours = /^(\d+(?:[.,]\d+)?)(?:hours?|hrs?|h)(?:(\d{1,2})(?:minutes?|mins?|m)?)?$/.exec(t);
  if (hours) return Math.round(Number(hours[1].replace(',', '.')) * 60) + Number(hours[2] ?? 0);
  const mins = /^(\d+)(?:minutes?|mins?|m)$/.exec(t);
  if (mins) return Number(mins[1]);
  return null;
}

export const snap = (value: number, step: number) => Math.round(value / step) * step;
