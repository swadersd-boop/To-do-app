import { useEffect, useMemo, useRef } from 'react';
import { Check, Pause, Play, SkipForward, X } from 'lucide-react';
import { useStore } from '../store';
import { useUI } from '../ui';
import { tasksOn, workQueue } from '../lib/model';
import { fmtClock, fmtMin, fmtStopwatch } from '../lib/time';
import { AddLine, ChannelPill, CheckCircle, TimerQuestion, useEscape, useNow, useTracked } from './bits';

export function FocusMode() {
  const id = useUI((s) => s.focusTaskId);
  const today = useUI((s) => s.today);
  const tasks = useStore((s) => s.tasks);
  const task = tasks.find((t) => t.id === id);
  const { startTimer, stopTimer, toggleDone, updateTask, updateSubtask, addSubtask } = useStore.getState();
  const panel = useRef<HTMLDivElement>(null);
  const lastAdvance = useRef(0);

  const clock = useNow(30_000);
  const nowMin = new Date(clock).getHours() * 60 + new Date(clock).getMinutes();
  // What comes next follows the timeline, not the order the list happens to be in.
  const queue = useMemo(
    () => workQueue(tasksOn(tasks, task?.date ?? today), nowMin).filter((t) => t.id !== id),
    [tasks, task?.date, today, id, nowMin],
  );
  // The next thing to work on skips meetings that have not started; the next meeting is mentioned separately.
  // Meetings are never something to focus on; the next one is mentioned below.
  const next = queue.find((t) => !t.fixed);
  // The next meeting, including one starting now or in a few minutes.
  const meeting = queue.find((t) => t.fixed && t.start !== null && t.start + 15 > nowMin);
  const { seconds, running } = useTracked(task?.id ?? '', task?.actualSec ?? 0);

  const close = () => useUI.getState().openModal(null);
  useEscape(close);

  useEffect(() => {
    panel.current?.focus();
  }, [id]);

  if (!task) {
    return (
      <div className="focus" role="dialog" aria-modal="true" aria-label="Focus">
        <div className="focus-inner">
          <h2 className="focus-title">Nothing left to focus on.</h2>
          <button type="button" className="btn btn-primary" onClick={close}>
            Back to the board
          </button>
        </div>
      </div>
    );
  }

  const plannedSec = (task.planned ?? 0) * 60;
  const pct = plannedSec > 0 ? Math.min(100, (seconds / plannedSec) * 100) : 0;
  // Over by a whole minute before saying so.
  const over = plannedSec > 0 && seconds >= plannedSec + 60;

  // Finishing or skipping stops the clock. The next task waits until you press Start.
  const advance = (markDone: boolean) => {
    // A quick second press (a double click) must not finish the next task too.
    if (Date.now() - lastAdvance.current < 2000) return;
    lastAdvance.current = Date.now();
    // Finished without ever pressing Start: count the time since it opened here, and say so.
    const openedAt = useUI.getState().focusOpenedAt;
    const since = openedAt ? Date.now() - openedAt : 0;
    if (markDone && !running && seconds < 60 && since >= 60_000 && since <= 4 * 3600_000) {
      const id = task.id;
      updateTask(id, { actualSec: Math.round(since / 1000) });
      useUI.getState().notify(`Counted ${fmtMin(since / 60_000)}, the time since you opened it.`, {
        label: 'Undo',
        run: () => useStore.getState().updateTask(id, { actualSec: 0 }),
      });
    }
    if (markDone) toggleDone(task.id);
    if (useStore.getState().timer) stopTimer();
    useUI.setState({ focusTaskId: next ? next.id : null, focusOpenedAt: Date.now() });
  };

  return (
    <div
      ref={panel}
      className="focus"
      role="dialog"
      aria-modal="true"
      aria-label={`Focus: ${task.title}`}
      tabIndex={-1}
    >
      <button type="button" className="icon-btn focus-close" onClick={close} aria-label="Leave focus mode">
        <X size={20} />
      </button>
      <div className="focus-inner">
        <TimerQuestion />
        <ChannelPill channelId={task.channelId} />
        <h2 className="focus-title">{task.title}</h2>

        <div className={`focus-clock ${over ? 'is-over' : ''} ${running ? '' : 'is-paused'}`} aria-live="off">
          {fmtStopwatch(seconds)}
        </div>
        <div className="focus-bar">
          <div className="focus-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="focus-sub">
          {task.planned === null
            ? 'No estimate'
            : over
              ? `${fmtMin((seconds - plannedSec) / 60)} over your ${fmtMin(task.planned)} estimate`
              : `of ${fmtMin(task.planned)} planned`}
          {!running && (seconds < 1 ? ' · press Start when you begin' : ' · paused')}
        </p>

        <div className="row focus-actions">
          {running ? (
            <button type="button" className="btn" onClick={() => stopTimer()}>
              <Pause size={15} />
              Pause
            </button>
          ) : (
            <button type="button" className={`btn ${seconds < 1 ? 'btn-primary' : ''}`} onClick={() => startTimer(task.id)}>
              <Play size={15} />
              {seconds < 1 ? 'Start' : 'Resume'}
            </button>
          )}
          <button type="button" className={`btn ${running || seconds >= 1 ? 'btn-primary' : ''}`} onClick={() => advance(true)}>
            <Check size={15} />
            Done
          </button>
          {next && (
            <button type="button" className="btn btn-quiet" onClick={() => advance(false)}>
              <SkipForward size={15} />
              Skip
            </button>
          )}
        </div>

        <div className="focus-work">
          {task.subtasks.length > 0 && (
            <ul className="subtasks">
              {task.subtasks.map((s) => (
                <li key={s.id} className={s.done ? 'is-done' : ''}>
                  <CheckCircle checked={s.done} onChange={() => updateSubtask(task.id, s.id, { done: !s.done })} label={`Step: ${s.title}`} size={18} />
                  <span>{s.title}</span>
                </li>
              ))}
            </ul>
          )}
          <AddLine placeholder="Add a step" label="Add a step" onAdd={(t) => addSubtask(task.id, t)} />
          <textarea
            className="field notes"
            value={task.notes}
            aria-label="Notes"
            placeholder="Notes while you work"
            onChange={(e) => updateTask(task.id, { notes: e.target.value })}
          />
        </div>

        <p className="focus-next">
          {next ? `Up next: ${next.title}${next.start !== null && next.start > nowMin ? ` at ${fmtClock(next.start)}` : ''}` : 'Nothing else to work on today.'}
          {meeting && (
            <>
              <br />
              {meeting.start! <= nowMin ? `Meeting now: ${meeting.title}` : `Next meeting: ${meeting.title} at ${fmtClock(meeting.start!)}`}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
