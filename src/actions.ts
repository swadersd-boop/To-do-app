import type { ISODate } from './types';
import { useStore } from './store';
import { useUI } from './ui';
import { parseQuickAdd } from './lib/parse';
import { relativeDay } from './lib/dates';

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
      planned: parsed.planned,
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
