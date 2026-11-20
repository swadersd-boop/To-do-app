import { useRef } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useStore } from '../store';
import { useUI } from '../ui';
import { readCalendar } from '../lib/ics';
import { addDays, diffDays, todayISO } from '../lib/dates';

/** How far ahead an import fills the board. */
export const CALENDAR_DAYS = 14;

/** Reads an .ics file and brings its meetings for the next two weeks onto the board. */
export async function importCalendarFile(file: File): Promise<void> {
  const { notify, today } = useUI.getState();
  let text: string;
  try {
    text = await file.text();
  } catch {
    notify(`Could not read ${file.name}.`);
    return;
  }
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    notify(`${file.name} is not a calendar file. Export your calendar as .ics and pick that.`);
    return;
  }
  const to = addDays(today, CALENDAR_DAYS - 1);
  const read = readCalendar(text, today, to);
  // The calendar's own name tells calendars apart; without one, the file name without the " (1)" a second download gets.
  const cal = (read.name ?? file.name.replace(/\.ics$/i, '').replace(/\s*\(\d+\)$/, '')).toLowerCase();
  const before = useStore.getState().tasks;
  const beforeDays = useStore.getState().days;
  const { added, updated, removed, replaced } = useStore.getState().importCalendar(read, today, to, cal, file.name);
  if (read.meetings.length === 0 && read.allDay.length === 0 && removed === 0) {
    notify(`No meetings in the next two weeks in ${file.name}.`);
    return;
  }
  const parts = [
    added > 0 ? `${added} added` : '',
    updated > 0 ? `${updated} updated` : '',
    removed > 0 ? `${removed} removed` : '',
  ].filter(Boolean);
  const took = replaced.length > 0 ? ` ${replaced.map((t) => `"${t}"`).join(' and ')} now ${replaced.length === 1 ? 'comes' : 'come'} from your calendar instead of repeating in Kalm.` : '';
  notify(
    (parts.length > 0
      ? `Meetings from ${file.name} for the next two weeks: ${parts.join(', ')}.`
      : `Your board already has every meeting in ${file.name} for the next two weeks.`) + took,
    { label: 'Undo', run: () => useStore.setState({ tasks: before, days: beforeDays }) },
  );
}

/** "Imported today", "Imported 3 days ago": how fresh the meetings on the board are. */
export function importedWhen(at: string): string {
  const days = diffDays(todayISO(), todayISO(new Date(at)));
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/** A button that asks for an .ics file and imports it. */
export function CalendarButton({ label = 'Import meetings from a calendar file', quiet = false }: { label?: string; quiet?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={`btn ${quiet ? 'btn-quiet' : ''}`} onClick={() => input.current?.click()}>
        <CalendarPlus size={14} />
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept=".ics,text/calendar"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importCalendarFile(f);
        }}
      />
    </>
  );
}
