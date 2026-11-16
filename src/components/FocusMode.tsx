import { useEffect, useMemo, useRef } from 'react';
import { Check, Pause, Play, SkipForward, X } from 'lucide-react';
import { useStore } from '../store';
import { useUI } from '../ui';
import { tasksOn } from '../lib/model';
import { fmtMin, fmtStopwatch } from '../lib/time';
import { AddLine, ChannelPill, CheckCircle, useEscape, useTracked } from './bits';

export function FocusMode() {
  const id = useUI((s) => s.focusTaskId);
  const today = useUI((s) => s.today);
  const tasks = useStore((s) => s.tasks);
  const task = tasks.find((t) => t.id === id);
  const { startTimer, stopTimer, toggleDone, updateTask, updateSubtask, addSubtask } = useStore.getState();
  const panel = useRef<HTMLDivElement>(null);

  const queue = useMemo(() => tasksOn(tasks, task?.date ?? today).filter((t) => !t.done && t.id !== id), [tasks, task?.date, today, id]);
  const next = queue[0];
  const { seconds, running } = useTracked(task?.id ?? '', task?.actualSec ?? 0);

  const close = () => useUI.getState().openModal(null);
  useEscape(close);

  useEffect(() => {
    panel.current?.focus();
  }, [id]);

  useEffect(() => {
    if (!task) return;
    const previous = document.title;
    document.title = `${fmtStopwatch(seconds)} · ${task.title}`;
    return () => {
      document.title = previous;
    };
  }, [seconds, task]);

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
  const over = plannedSec > 0 && seconds > plannedSec;

  const advance = (markDone: boolean) => {
    if (markDone) toggleDone(task.id);
    else stopTimer();
    if (next) {
      startTimer(next.id);
      useUI.getState().focusOn(next.id);
    } else {
      useUI.setState({ focusTaskId: null });
    }
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
          {!running && ' · paused'}
        </p>

        <div className="row focus-actions">
          {running ? (
            <button type="button" className="btn" onClick={() => stopTimer()}>
              <Pause size={15} />
              Pause
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => startTimer(task.id)}>
              <Play size={15} />
              Resume
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => advance(true)}>
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

        <p className="focus-next">{next ? `Up next: ${next.title}` : 'This is the last task of the day.'}</p>
      </div>
    </div>
  );
}
