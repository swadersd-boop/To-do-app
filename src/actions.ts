import type { ISODate } from './types';
import { snapshot, useStore } from './store';
import { useUI } from './ui';
import { parseQuickAdd } from './lib/parse';
import { fmtClock } from './lib/time';
import { occursOn } from './lib/model';
import { nextWorkday, relativeDay, toISO } from './lib/dates';

/** Creates a task from one typed line. Returns its id, or null for an empty title. */
export function addFromText(text: string, fallbackDate: ISODate | null, atTop = false): string | null {
  const { today, notify } = useUI.getState();
  const parsed = parseQuickAdd(text, today);
  if (!parsed.title) return null;
  const store = useStore.getState();
  const date = parsed.date === undefined ? fallbackDate : parsed.date;
  // The same meeting at the same time is already there, for example from a repeating series.
  const same = (t: { title: string; start: number | null; fixed?: boolean }) =>
    t.fixed && t.start === parsed.start && t.title.trim().toLowerCase() === parsed.title.trim().toLowerCase();
  const on = date === null ? '' : ['Today', 'Tomorrow'].includes(relativeDay(date, today)) ? relativeDay(date, today).toLowerCase() : relativeDay(date, today);
  if (parsed.start !== null && date !== null) {
    const twin = store.tasks.find((t) => t.date === date && same(t));
    if (twin) {
      notify(`"${twin.title}" at ${fmtClock(twin.start!)} is already on ${on}.`);
      return null;
    }
    // A repeating meeting that will land on that day already covers it.
    const series = store.tasks.find((t) => same(t) && occursOn(t, date));
    if (series) {
      notify(`"${series.title}" repeats ${series.repeat === 'weekly' ? 'every week' : series.repeat === 'weekdays' ? 'on weekdays' : 'every day'}, so it is already on ${on}.`);
      return null;
    }
  }
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
  ui.notify(removed.calendarKey ? 'Meeting deleted. Importing the calendar again will not bring it back.' : 'Task deleted', {
    label: 'Undo',
    run: () => useStore.getState().restoreTask(removed),
  });
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
/**
 * Moves tasks to the next working day. `byPlan` marks moves the plan made for
 * you when the day was full: those do not count toward parking a task in the
 * backlog, since you did not choose to put it off.
 */
export function moveToTomorrow(ids: string[], prefix = '', byPlan = false): void {
  const store = useStore.getState();
  const { today, notify } = useUI.getState();
  const before = store.tasks;
  const beforeDays = store.days;
  const target = nextWorkday(today, Boolean(store.settings.weekendRollover));
  // A task added today and moved by the plan has not really moved on yet.
  const createdToday = (id: string) => {
    const t = before.find((x) => x.id === id);
    return Boolean(t) && toISO(new Date(t!.createdAt)) === today;
  };
  const parked = ids.filter((id) => store.defer(id, target, { counts: !byPlan && !createdToday(id) }) === 'backlog');
  const moved = ids.filter((id) => !parked.includes(id));
  const titles = (list: string[]) => nameTasks(before.filter((t) => list.includes(t.id)));
  const message = [
    prefix,
    moved.length > 0 ? `Moved ${titles(moved)} to ${relativeDay(target, today).toLowerCase() === 'tomorrow' ? 'tomorrow' : relativeDay(target, today)}.` : '',
    parked.length > 0 ? `${titles(parked)} went to the backlog after moving on too often.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  notify(message, { label: 'Undo', run: () => useStore.setState({ tasks: before, days: beforeDays }) });
}

/** Puts one task off to tomorrow, and says so if it went to the backlog instead. */
export function deferOne(id: string): void {
  const store = useStore.getState();
  const { today, notify } = useUI.getState();
  const before = store.tasks;
  const beforeDays = store.days;
  if (store.defer(id, nextWorkday(today, Boolean(store.settings.weekendRollover))) === 'backlog') {
    const title = before.find((t) => t.id === id)?.title ?? 'The task';
    notify(`"${title}" went to the backlog after moving on too often.`, { label: 'Undo', run: () => useStore.setState({ tasks: before, days: beforeDays }) });
  }
}

/** Saves everything as a JSON file, and remembers when, for the weekly reminder. */
export function downloadBackup(): void {
  const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kalm-backup-${useUI.getState().today}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  useStore.getState().setSettings({ backupAt: new Date().toISOString() });
}

/**
 * Everything lives in this browser, so once a week, when there is real work to
 * lose, the app offers a backup. At most once a day, and never before a week of use.
 */
export function maybeNudgeBackup(): void {
  const { settings, tasks, setSettings } = useStore.getState();
  const today = useUI.getState().today;
  const real = tasks.filter((t) => !t.example);
  if (real.length < 10 || settings.backupNudgedOn === today) return;
  const since = settings.backupAt ?? real.reduce((min, t) => (t.createdAt < min ? t.createdAt : min), real[0].createdAt);
  if (Date.now() - new Date(since).getTime() < 7 * 86_400_000) return;
  setSettings({ backupNudgedOn: today });
  useUI.getState().notify(
    settings.backupAt ? 'Your last backup is over a week old. Everything lives in this browser only.' : 'Everything lives in this browser only. Save a backup now and then.',
    { label: 'Download backup', run: downloadBackup },
  );
}
