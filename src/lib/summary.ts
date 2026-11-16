import type { Channel, ISODate, Task } from '../types';
import { longDate } from './dates';
import { fmtMin } from './time';
import { actualTotal, plannedTotal } from './stats';

const tag = (t: Task, channels: Channel[]) => {
  const c = channels.find((x) => x.id === t.channelId);
  return c ? ` #${c.name}` : '';
};

/** The morning plan as plain text, ready to paste into a chat. */
export function planText(date: ISODate, tasks: Task[], channels: Channel[], intention: string): string {
  const lines = [`Plan for ${longDate(date)}`];
  if (intention.trim()) lines.push(`Focus: ${intention.trim()}`);
  lines.push('');
  tasks.forEach((t, i) => lines.push(`${i + 1}. ${t.title}${t.planned ? ` (${fmtMin(t.planned)})` : ''}${tag(t, channels)}`));
  if (tasks.length === 0) lines.push('Nothing planned yet.');
  const total = plannedTotal(tasks);
  if (total > 0) lines.push('', `Total: ${fmtMin(total)}`);
  return lines.join('\n');
}

/** The end-of-day recap as plain text. */
export function shutdownText(date: ISODate, tasks: Task[], channels: Channel[], reflection: string): string {
  const done = tasks.filter((t) => t.done);
  const open = tasks.filter((t) => !t.done);
  const lines = [`Shutdown for ${longDate(date)}`, ''];
  if (done.length > 0) {
    lines.push(`Done (${done.length}):`);
    for (const t of done) {
      const tracked = t.actualSec >= 60 ? `: ${fmtMin(t.actualSec / 60)}` : '';
      const planned = t.planned ? ` (planned ${fmtMin(t.planned)})` : '';
      lines.push(`- ${t.title}${tracked}${tracked ? planned : ''}${tag(t, channels)}`);
    }
  }
  if (open.length > 0) {
    if (done.length > 0) lines.push('');
    lines.push(`Not done (${open.length}):`);
    for (const t of open) lines.push(`- ${t.title}${tag(t, channels)}`);
  }
  if (tasks.length === 0) lines.push('Nothing was planned today.');
  const actual = actualTotal(tasks);
  if (actual >= 1) lines.push('', `Tracked ${fmtMin(actual)} against ${fmtMin(plannedTotal(tasks))} planned.`);
  if (reflection.trim()) lines.push('', `Reflection: ${reflection.trim()}`);
  return lines.join('\n');
}
