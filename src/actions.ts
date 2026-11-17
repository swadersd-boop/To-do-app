import type { ISODate } from './types';
import { useStore } from './store';
import { useUI } from './ui';
import { parseQuickAdd } from './lib/parse';
import { addDays, relativeDay } from './lib/dates';

/** Creates a task from one typed line. Returns its id, or null for an empty title. */
export function addFromText(text: string, fallbackDate: ISODate | null, atTop = false): string | null {
  const { today, notify } = useUI.getState();
  const parsed = parseQuickAdd(text, today);
  if (!parsed.title) return null;
  const store = useStore.getState();
  const date = parsed.date === undefined ? fallbackDate : parsed.date;
  const id = store.addTask(
    {
      title: parsed.title,
      date,
      // A meeting typed without a length gets the usual half hour, so it shows its real size everywhere.
      planned: parsed.planned ?? (parsed.start !== null && date !== null ? 30 : null),
      channelId: parsed.channel ? store.channelByName(parsed.channel) : null,
      start: parsed.start,
      // A time someone typed is a commitment. A time from dragging or "Fill my day" is a plan.
      fixed: parsed.start !== null && date !== null,
    },
    atTop,
  );
  if (date !== fallbackDate) notify(`Added to ${date === null ? 'the backlog' : relativeDay(date, today)}`);
  return id;
}

export function deleteWithUndo(id: string): void {
  const store = useStore.getState();
  const ui = useUI.getState();
  const removed = store.deleteTask(id);
  if (!removed) return;
  if (ui.openTaskId === id) ui.openTask(null);
  ui.notify('Task deleted', { label: 'Undo', run: () => useStore.getState().restoreTask(removed) });
}

export async function copyText(text: string, message = 'Copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    useUI.getState().notify(message);
  } catch {
    useUI.getState().notify('Could not copy. Select the text and copy it by hand.');
  }
}

/** Names a few tasks for a message: "A", "A and B", "A, B and 3 more". */
export function nameTasks(tasks: { title: string }[]): string {
  const quote = (t: { title: string }) => `"${t.title.length > 40 ? `${t.title.slice(0, 38)}…` : t.title}"`;
  if (tasks.length <= 2) return tasks.map(quote).join(' and ');
  return `${tasks.slice(0, 2).map(quote).join(', ')} and ${tasks.length - 2} more`;
}

/** Sends tasks that did not fit to tomorrow, with an undo. */
export function moveToTomorrow(ids: string[]): void {
  const store = useStore.getState();
  const { today, notify } = useUI.getState();
  const before = store.tasks;
  for (const id of ids) store.sendTo(id, addDays(today, 1));
  notify(`Moved ${ids.length} task${ids.length === 1 ? '' : 's'} to tomorrow`, { label: 'Undo', run: () => useStore.setState({ tasks: before }) });
}
