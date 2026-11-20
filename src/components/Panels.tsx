import { useMemo, useRef } from 'react';
import { Download, Trash2, Upload } from 'lucide-react';
import { CHANNEL_COLORS, isPlannerData, useStore } from '../store';
import { CalendarButton, importedList } from './CalendarImport';
import { downloadBackup } from '../actions';
import { useUI } from '../ui';
import { addDays, shortDate, weekStart, weekdayName } from '../lib/dates';
import { fmtClock, fmtMin } from '../lib/time';
import { type Honesty, MIN_SAMPLES, honesty, todos, weekSummary, workDone } from '../lib/stats';
import { AddLine, Dialog } from './bits';

const close = () => useUI.getState().openModal(null);

export function Settings() {
  const settings = useStore((s) => s.settings);
  const channels = useStore((s) => s.channels);
  const { setSettings, updateChannel, deleteChannel, channelByName, importData, reset } = useStore.getState();
  const notify = useUI((s) => s.notify);
  const file = useRef<HTMLInputElement>(null);

  const exportData = downloadBackup;

  const onImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data: unknown = JSON.parse(await f.text());
      if (!isPlannerData(data)) throw new Error('wrong shape');
      if (!window.confirm(`Replace everything here with the ${data.tasks.length} tasks in this backup?`)) return;
      importData(data);
      notify('Backup restored');
    } catch {
      notify('That file is not a Kalm backup.');
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  const hours = Array.from({ length: 25 }, (_, i) => i);

  return (
    <Dialog title="Settings" onClose={close}>
      <div className="form">
        <label className="stack">
          <span>Your name (shown on plans you share)</span>
          <input className="field" value={settings.name} onChange={(e) => setSettings({ name: e.target.value })} placeholder="Optional" />
        </label>

        <label className="stack">
          <span>Hours of planned work that fit in a day</span>
          <input
            className="field field-short"
            type="number"
            min={1}
            max={16}
            step={0.5}
            value={settings.capacityMin / 60}
            onChange={(e) => {
              const h = Number(e.target.value);
              if (h >= 1 && h <= 16) setSettings({ capacityMin: Math.round(h * 60) });
            }}
          />
        </label>

        <div className="row wrap">
          <label className="stack">
            <span>Timeline starts</span>
            <select className="field" value={settings.dayStart} onChange={(e) => setSettings({ dayStart: Math.min(Number(e.target.value), settings.dayEnd - 1) })}>
              {hours.slice(0, 24).map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
          <label className="stack">
            <span>Timeline ends</span>
            <select className="field" value={settings.dayEnd} onChange={(e) => setSettings({ dayEnd: Math.max(Number(e.target.value), settings.dayStart + 1) })}>
              {hours.slice(1).map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
          <label className="stack">
            <span>Theme</span>
            <select className="field" value={settings.theme} onChange={(e) => setSettings({ theme: e.target.value as typeof settings.theme })}>
              <option value="system">Match my device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>

        <div className="row wrap">
          <label className="stack">
            <span>Lunch break</span>
            <select
              className="field"
              value={settings.lunchStart ?? ''}
              onChange={(e) => setSettings({ lunchStart: e.target.value === '' ? null : Number(e.target.value) })}
            >
              <option value="">No break</option>
              {[690, 720, 750, 780, 810].map((m) => (
                <option key={m} value={m}>
                  {fmtClock(m)}
                </option>
              ))}
            </select>
          </label>
          {settings.lunchStart !== null && settings.lunchStart !== undefined && (
            <label className="stack">
              <span>for</span>
              <select className="field" value={settings.lunchLength ?? 60} onChange={(e) => setSettings({ lunchLength: Number(e.target.value) })}>
                {[30, 45, 60, 90].map((m) => (
                  <option key={m} value={m}>
                    {fmtMin(m)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className="muted hint">Planning keeps the break free. Meetings can still go in it.</p>

        <label className="check-row">
          <input type="checkbox" checked={settings.autoRollover} onChange={(e) => setSettings({ autoRollover: e.target.checked })} />
          Carry unfinished tasks over to today automatically
        </label>
        {settings.autoRollover && (
          <label className="stack">
            <span>Send a task to the backlog after it has moved on</span>
            <select
              className="field"
              value={settings.parkAfter === undefined ? 3 : (settings.parkAfter ?? '')}
              onChange={(e) => setSettings({ parkAfter: e.target.value === '' ? null : Number(e.target.value) })}
            >
              <option value={2}>2 times</option>
              <option value={3}>3 times</option>
              <option value={5}>5 times</option>
              <option value="">Never</option>
            </select>
          </label>
        )}
        {settings.autoRollover && (
          <label className="check-row">
            <input type="checkbox" checked={Boolean(settings.weekendRollover)} onChange={(e) => setSettings({ weekendRollover: e.target.checked })} />
            Also on Saturdays and Sundays (otherwise Friday's leftovers wait for Monday)
          </label>
        )}

        <h4>Channels</h4>
        <ul className="channel-list">
          {channels.map((c) => (
            <li key={c.id}>
              <input type="color" value={c.color} aria-label={`Colour of ${c.name}`} onChange={(e) => updateChannel(c.id, { color: e.target.value })} list="kalm-colors" />
              <span aria-hidden="true">#</span>
              <input className="field" defaultValue={c.name} aria-label="Channel name" onBlur={(e) => updateChannel(c.id, { name: e.target.value })} />
              <button type="button" className="icon-btn" aria-label={`Delete channel ${c.name}`} onClick={() => deleteChannel(c.id)}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
        <datalist id="kalm-colors">
          {CHANNEL_COLORS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <AddLine placeholder="Add a channel" label="Add a channel" onAdd={(t) => channelByName(t)} />

        <button type="button" className="btn btn-quiet help-link" onClick={() => useUI.getState().openModal('help')}>
          How quick add and the shortcuts work
        </button>

        <h4>Calendar</h4>
        <p className="muted">
          Bring in your meetings from Google Calendar, Outlook or Apple Calendar. Save your calendar as an .ics file and pick it here: Kalm adds the
          meetings of the next two weeks with fixed times. Import the same file again after changes, and moved meetings move and cancelled ones go.
        </p>
        <p className="muted">
          In Google Calendar: Settings, Import &amp; export, Export, then unzip the download. Kalm cannot read your calendar by itself, because it
          keeps everything in this browser.
        </p>
        <div className="row wrap">
          <CalendarButton />
          {settings.calendarImport && <span className="muted">Imported: {importedList(settings.calendarImports, settings.calendarImport)}</span>}
          {(settings.calendarHidden?.length ?? 0) > 0 && (
            <button type="button" className="btn btn-quiet" onClick={() => setSettings({ calendarHidden: [] })}>
              Show {settings.calendarHidden!.length} deleted {settings.calendarHidden!.length === 1 ? 'meeting' : 'meetings'} again on the next import
            </button>
          )}
        </div>

        <h4>Your data</h4>
        <p className="muted">Everything is stored in this browser and nowhere else. Download a backup now and then, or to move to another device.</p>
        <div className="row wrap">
          <button type="button" className="btn" onClick={exportData}>
            <Download size={14} />
            Download backup
          </button>
          <button type="button" className="btn" onClick={() => file.current?.click()}>
            <Upload size={14} />
            Restore from backup
          </button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => onImport(e.target.files?.[0])} />
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-quiet btn-danger"
            onClick={() => {
              if (window.confirm('Delete every task, objective and setting in this browser? This cannot be undone.')) {
                reset();
                notify('Started over');
              }
            }}
          >
            Erase everything
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** "30% longer", "20% less", or "about right". */
function describe(h: Honesty): string {
  const pct = Math.round(Math.abs(h.ratio - 1) * 100);
  if (pct < 8) return 'about right';
  return h.ratio > 1 ? `${pct}% longer` : `${pct}% less`;
}

function lead(h: Honesty): string {
  const pct = Math.round(Math.abs(h.ratio - 1) * 100);
  if (pct < 8) return 'Your estimates are about right.';
  return h.ratio > 1 ? `Tasks take about ${pct}% longer than you estimate.` : `Tasks take about ${pct}% less time than you estimate.`;
}

export function Insights() {
  const tasks = useStore((s) => s.tasks);
  const channels = useStore((s) => s.channels);
  const today = useUI((s) => s.today);
  const days = useStore((s) => s.days);
  const h = useMemo(() => honesty(tasks), [tasks]);
  const objectives = useStore((s) => s.objectives);
  // Leave out the time before Kalm was first used.
  const firstDay = useMemo(
    () => [...tasks.map((t) => t.createdAt.slice(0, 10)), ...Object.keys(days)].sort()[0] ?? today,
    [tasks, days, today],
  );
  const thisWeek = weekStart(today);
  const weeks = useMemo(
    () =>
      [0, 1, 2, 3]
        .map((i) => addDays(thisWeek, -7 * i))
        .filter((start) => addDays(start, 6) >= firstDay)
        .map((start) => weekSummary(tasks, days, objectives, start)),
    [tasks, days, objectives, thisWeek, firstDay],
  );
  const dayRows = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => addDays(thisWeek, i))
        .filter((date) => date <= today && date >= firstDay)
        .map((date) => {
          const all = tasks.filter((t) => t.date === date);
          return { date, done: todos(all).filter((t) => t.done).length, movedOn: days[date]?.carried ?? 0, tracked: workDone(all, days[date]) };
        }),
    [tasks, days, thisWeek, today, firstDay],
  );

  return (
    <Dialog title="Insights" onClose={close}>
      {h.overall ? (
        <>
          <p className="insight-lead">
            <strong>{lead(h.overall)}</strong>
          </p>
          <p className="muted">
            Based on {h.overall.samples} finished tasks that had both an estimate and tracked time. The planning ritual uses this to tell you what a day will
            really cost.
          </p>
          {Object.keys(h.byChannel).length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Compared with estimates</th>
                  <th className="num">Tasks</th>
                </tr>
              </thead>
              <tbody>
                {channels
                  .filter((c) => h.byChannel[c.id])
                  .map((c) => (
                    <tr key={c.id}>
                      <td>
                        <span className="pill">
                          <span className="dot" style={{ background: c.color }} />
                          {c.name}
                        </span>
                      </td>
                      <td>{describe(h.byChannel[c.id])}</td>
                      <td className="num">{h.byChannel[c.id].samples}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <p className="insight-lead">
          Not enough history yet. Finish {MIN_SAMPLES} tasks that have an estimate and tracked time, and Kalm will tell you how far off your estimates run.
        </p>
      )}

      <h4>Weeks</h4>
      <table className="table">
        <thead>
          <tr>
            <th>Week of</th>
            <th className="num">Done</th>
            <th className="num">Worked</th>
            <th className="num" title="To-dos still open when the week ended">Left over</th>
            <th className="num">Objectives</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.start} className={w.start === thisWeek ? 'is-today' : ''}>
              <td>{w.start === thisWeek ? 'This week' : shortDate(w.start)}</td>
              <td className="num">{w.done}</td>
              <td className="num">{w.tracked >= 1 ? fmtMin(w.tracked) : ''}</td>
              <td className="num">{w.start === thisWeek ? '' : w.leftOver}</td>
              <td className="num">{w.objectives > 0 ? `${w.objectivesDone} of ${w.objectives}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {dayRows.length > 0 && (
        <>
          <h4>This week by day</h4>
          <table className="table">
            <thead>
              <tr>
                <th>Day</th>
                <th className="num">Done</th>
                <th className="num" title="Unfinished tasks that moved on to the next day">Moved on</th>
                <th className="num">Worked</th>
              </tr>
            </thead>
            <tbody>
              {dayRows.map((d) => (
                <tr key={d.date} className={d.date === today ? 'is-today' : ''}>
                  <td>
                    {weekdayName(d.date, 'short')} {shortDate(d.date)}
                  </td>
                  <td className="num">{d.done}</td>
                  <td className="num">{d.movedOn || ''}</td>
                  <td className="num">{d.tracked >= 1 ? fmtMin(d.tracked) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Dialog>
  );
}

const KEYS: [string, string][] = [
  ['N', 'Add a task to today'],
  ['P', 'Plan today'],
  ['S', 'Shut down the day'],
  ['F', 'Focus on the first unfinished task'],
  ['T', 'Jump back to today'],
  ['← →', 'Move the board a day'],
  ['Shift ← →', 'Move the board a week'],
  ['B', 'Show or hide the backlog'],
  ['L', 'Show or hide the timeline'],
  ['?', 'This list'],
  ['Enter', 'On a task: open it'],
  ['X', 'On a task: mark it done'],
  ['Space', 'On a task: pick it up, move with the arrow keys, drop with Space'],
  ['Delete', 'On a task: remove it'],
];

export function Help() {
  return (
    <Dialog title="Shortcuts and quick add" onClose={close}>
      <table className="table">
        <tbody>
          {KEYS.map(([key, what]) => (
            <tr key={key}>
              <td>
                <kbd>{key}</kbd>
              </td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Quick add</h4>
      <p className="muted">Type everything on one line and press Enter.</p>
      <pre className="summary">Write proposal 45m #work @14:30 tomorrow</pre>
      <ul className="plain-list">
        <li>
          <code>45m</code>, <code>1h</code>, <code>1h30</code> or <code>1.5h</code> sets the estimate.
        </li>
        <li>
          <code>#work</code> files it under a channel, and creates the channel if it is new.
        </li>
        <li>
          <code>@14:30</code>, <code>@2pm</code> or <code>@12:30-13:30</code> gives it a fixed time, like a meeting. "Fill my day" never moves it.
        </li>
        <li>
          <code>today</code>, <code>tomorrow</code>, <code>fri</code>, <code>on Friday</code> or <code>later</code> as the last word picks the day.
        </li>
      </ul>
    </Dialog>
  );
}
