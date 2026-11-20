import type { Channel, ISODate, Task } from '../types';
import { longDate } from './dates';
import { fmtClock, fmtMin } from './time';
import { plannedTotal, todaySec, workDone, workedMin, workLeft } from './stats';
import { estimateUsedUp, leftOf, needOf } from './model';

const tag = (t: Task, channels: Channel[]) => {
  const c = channels.find((x) => x.id === t.channelId);
  return c ? ` #${c.name}` : '';
};

/** "(1h)", or "(1h left of 3h)" for a task already started. */
function size(t: Task, pace?: (t: Task) => number): string {
  const base = sizeOnly(t);
  if (!pace || !base || t.fixed || estimateUsedUp(t)) return base;
  // Planning at your pace books more than the estimate says; the line says so, so it matches the timeline.
  const need = needOf(t, pace);
  const left = leftOf(t) ?? 0;
  return need - left >= 10 ? `${base.slice(0, -1)}, about ${fmtMin(need)} at your pace)` : base;
}

function sizeOnly(t: Task): string {
  if (!t.planned) return '';
  const done = t.actualSec / 60;
  if (done < 1) return ` (${fmtMin(t.planned)})`;
  const left = leftOf(t) ?? 0;
  if (t.left && left > 0) return ` (${fmtMin(left)} still needed, past its ${fmtMin(t.planned)} estimate)`;
  if (left <= 0) return ` (past its ${fmtMin(t.planned)} estimate)`;
  return ` (${fmtMin(Math.max(0, t.planned - done))} left of ${fmtMin(t.planned)})`;
}

/** The morning plan as plain text, ready to paste into a chat. */
export function planText(
  date: ISODate,
  tasks: Task[],
  channels: Channel[],
  intention: string,
  pace?: (t: Task) => number,
  /** Minutes booked today for tasks that only partly fit. */
  partly: Record<string, number> = {},
): string {
  const lines = [`Plan for ${longDate(date)}`];
  if (intention.trim()) lines.push(`Focus: ${intention.trim()}`);
  lines.push('');
  tasks.forEach((t, i) =>
    lines.push(`${i + 1}. ${t.start !== null ? `${fmtClock(t.start)} ` : ''}${t.title}${size(t, pace)}${partly[t.id] ? `, ${fmtMin(partly[t.id])} of it today` : ''}${tag(t, channels)}`),
  );
  if (tasks.length === 0) lines.push('Nothing planned yet.');
  // The same measure as the plan: what the to-dos still need by their estimates, and at your pace when that differs.
  const work = workLeft(tasks);
  const atPace = pace ? workLeft(tasks, pace) : work;
  const meetings = plannedTotal(tasks.filter((t) => t.fixed));
  const workLine = work > 0 ? (Math.abs(atPace - work) >= 5 ? `Work: ${fmtMin(work)} by your estimates, about ${fmtMin(atPace)} at your pace` : `Work: ${fmtMin(work)}`) : '';
  if (work + meetings > 0) lines.push('', [workLine, meetings > 0 ? `Meetings: ${fmtMin(meetings)}` : ''].filter(Boolean).join(' · '));
  return lines.join('\n');
}

/** The end-of-day recap as plain text. */
export function shutdownText(
  date: ISODate,
  tasks: Task[],
  channels: Channel[],
  reflection: string,
  pace?: (t: Task) => number,
  log?: { carriedSec?: number; carriedTitles?: string[]; carriedWork?: { title: string; sec: number }[] },
): string {
  const done = tasks.filter((t) => t.done && !t.fixed);
  const open = tasks.filter((t) => !t.done);
  const lines = [`Shutdown for ${longDate(date)}`, ''];
  if (done.length > 0) {
    lines.push(`Done (${done.length}):`);
    for (const t of done) {
      const before = t.actualSec - todaySec(t);
      // Finished without the timer: say what was counted for it, so the lines add up to the total.
      const untimed = todaySec(t) < 60 && workedMin(t) >= 1 ? `: ${fmtMin(workedMin(t))}, not timed` : '';
      const tracked = todaySec(t) >= 60 ? `: ${fmtMin(todaySec(t) / 60)}${before >= 60 ? ` today, ${fmtMin(t.actualSec / 60)} in all` : ''}` : untimed;
      const planned = t.planned ? ` (planned ${fmtMin(t.planned)})` : '';
      lines.push(`- ${t.title}${tracked}${tracked ? planned : ''}${tag(t, channels)}`);
    }
  }
  const left = open.filter((t) => !t.fixed);
  if (left.length > 0) {
    if (done.length > 0) lines.push('');
    lines.push(`Not done (${left.length}):`);
    // Time spent on unfinished work is still work done today.
    for (const t of left) lines.push(`- ${t.title}${todaySec(t) >= 60 ? `: ${fmtMin(todaySec(t) / 60)} worked` : ''}${tag(t, channels)}`);
  }
  // Work put off to a later day still happened today, so the recap says where that time went.
  const movedOn = (log?.carriedWork ?? []).filter((w) => w.sec >= 60 && !tasks.some((t) => t.title === w.title));
  if (movedOn.length > 0) {
    lines.push('', `Moved to a later day (${movedOn.length}):`);
    for (const w of movedOn) lines.push(`- ${w.title}: ${fmtMin(w.sec / 60)} worked`);
  }
  if (tasks.length === 0 && movedOn.length === 0) lines.push('Nothing was planned today.');
  // The same two numbers as the day column: work done today, and what is still left at the plan's pace.
  const actual = workDone(tasks, log);
  const undone = workLeft(tasks, pace);
  // Tasks past their estimate have no number left, so they are named rather than counted.
  const unknown = tasks.filter((t) => !t.fixed && estimateUsedUp(t)).length;
  const more = unknown > 0 ? `, plus ${unknown} ${unknown === 1 ? 'task' : 'tasks'} past ${unknown === 1 ? 'its' : 'their'} estimate` : '';
  if (actual >= 1 || undone > 0 || unknown > 0)
    lines.push(
      '',
      [actual >= 1 ? `Worked ${fmtMin(actual)}.` : '', undone > 0 || unknown > 0 ? `${undone > 0 ? fmtMin(undone) : 'None'} of work left undone${more}.` : '']
        .filter(Boolean)
        .join(' '),
    );
  if (reflection.trim()) lines.push('', `Reflection: ${reflection.trim()}`);
  return lines.join('\n');
}

/** What a partly booked task gets today, against what it needs in all. */
export function partlyText(p: { task: Task; minutes: number; need: number }): string {
  const byEstimate = leftOf(p.task) ?? 0;
  const atPace = p.need > byEstimate + 4 ? ' at your pace' : '';
  return `"${p.task.title}" gets ${fmtMin(p.minutes)} today of the ${fmtMin(p.need)} it needs${atPace}. The rest stays on the list.`;
}
