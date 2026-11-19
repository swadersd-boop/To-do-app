import { useRef } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useStore } from '../store';
import { useUI } from '../ui';
import { parseCalendar } from '../lib/ics';
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
  // The file name tells calendars apart, so importing a second calendar never clears the first.
  const source = file.name.replace(/\.ics$/i, '').toLowerCase();
  const meetings = parseCalendar(text, today, to, source);
  const before = useStore.getState().tasks;
  const { added, updated, removed } = useStore.getState().importCalendar(meetings, today, to, source, file.name);
  if (meetings.length === 0 && removed === 0) {
    notify(`No meetings with a time in the next two weeks in ${file.name}. All-day events are left out.`);
    return;
  }
  const parts = [
    added > 0 ? `${added} added` : '',
    updated > 0 ? `${updated} updated` : '',
    removed > 0 ? `${removed} removed` : '',
  ].filter(Boolean);
  notify(
    parts.length > 0
      ? `Meetings from ${file.name} for the next two weeks: ${parts.join(', ')}.`
      : `Your board already has every meeting in ${file.name} for the next two weeks.`,
    { label: 'Undo', run: () => useStore.setState({ tasks: before }) },
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
