import type { Channel, ISODate, Task } from '../types';
import { longDate } from './dates';
import { fmtClock, fmtMin } from './time';
import { plannedTotal, todaySec, workDone, workLeft } from './stats';

const tag = (t: Task, channels: Channel[]) => {
  const c = channels.find((x) => x.id === t.channelId);
  return c ? ` #${c.name}` : '';
};

/** "(1h)", or "(1h left of 3h)" for a task already started. */
function size(t: Task): string {
  if (!t.planned) return '';
  const done = t.actualSec / 60;
  if (done < 1) return ` (${fmtMin(t.planned)})`;
  if (done >= t.planned) return ` (past its ${fmtMin(t.planned)} estimate)`;
  return ` (${fmtMin(Math.max(0, t.planned - done))} left of ${fmtMin(t.planned)})`;
}

/** The morning plan as plain text, ready to paste into a chat. */
export function planText(date: ISODate, tasks: Task[], channels: Channel[], intention: string, pace?: (t: Task) => number): string {
  const lines = [`Plan for ${longDate(date)}`];
  if (intention.trim()) lines.push(`Focus: ${intention.trim()}`);
  lines.push('');
  tasks.forEach((t, i) =>
    lines.push(`${i + 1}. ${t.start !== null ? `${fmtClock(t.start)} ` : ''}${t.title}${size(t)}${tag(t, channels)}`),
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
export function shutdownText(date: ISODate, tasks: Task[], channels: Channel[], reflection: string, pace?: (t: Task) => number): string {
  const done = tasks.filter((t) => t.done && !t.fixed);
  const open = tasks.filter((t) => !t.done);
  const lines = [`Shutdown for ${longDate(date)}`, ''];
  if (done.length > 0) {
    lines.push(`Done (${done.length}):`);
    for (const t of done) {
      const before = t.actualSec - todaySec(t);
      const tracked = todaySec(t) >= 60 ? `: ${fmtMin(todaySec(t) / 60)}${before >= 60 ? ` today, ${fmtMin(t.actualSec / 60)} in all` : ''}` : '';
      const planned = t.planned ? ` (planned ${fmtMin(t.planned)})` : '';
      lines.push(`- ${t.title}${tracked}${tracked ? planned : ''}${tag(t, channels)}`);
    }
  }
  const left = open.filter((t) => !t.fixed);
  if (left.length > 0) {
    if (done.length > 0) lines.push('');
    lines.push(`Not done (${left.length}):`);
    for (const t of left) lines.push(`- ${t.title}${tag(t, channels)}`);
  }
  if (tasks.length === 0) lines.push('Nothing was planned today.');
  // The same two numbers as the day column: work done today, and what is still left at the plan's pace.
  const actual = workDone(tasks);
  const undone = workLeft(tasks, pace);
  if (actual >= 1 || undone > 0) lines.push('', [actual >= 1 ? `Worked ${fmtMin(actual)}.` : '', undone > 0 ? `${fmtMin(undone)} of work left undone.` : ''].filter(Boolean).join(' '));
  if (reflection.trim()) lines.push('', `Reflection: ${reflection.trim()}`);
  return lines.join('\n');
}
