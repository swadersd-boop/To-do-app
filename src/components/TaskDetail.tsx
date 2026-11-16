import { useEffect, useMemo, useRef } from 'react';
import { Play, Trash2, X } from 'lucide-react';
import type { Repeat, Task } from '../types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { deleteWithUndo } from '../actions';
import { addDays, weekStart } from '../lib/dates';
import { fmtClock, parseClock } from '../lib/time';
import { AddLine, CheckCircle, DurationInput, EstimateChip, useEscape, useTracked } from './bits';

export function TaskDetail() {
  const id = useUI((s) => s.openTaskId);
  const task = useStore((s) => s.tasks.find((t) => t.id === id));
  const close = () => useUI.getState().openTask(null);

  useEffect(() => {
    if (id && !task) close();
  }, [id, task]);

  if (!task) return null;
  return <Drawer key={task.id} task={task} onClose={close} />;
}

function Drawer({ task, onClose }: { task: Task; onClose: () => void }) {
  const channels = useStore((s) => s.channels);
  const allObjectives = useStore((s) => s.objectives);
  const { updateTask, toggleDone, addSubtask, updateSubtask, deleteSubtask, startTimer } = useStore.getState();
  const today = useUI((s) => s.today);
  const focusOn = useUI((s) => s.focusOn);
  const { seconds } = useTracked(task.id, task.actualSec);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const objectives = useMemo(
    () => allObjectives.filter((o) => o.weekStart === weekStart(today) || o.id === task.objectiveId),
    [allObjectives, today, task.objectiveId],
  );

  useEffect(() => {
    panel.current?.focus();
  }, []);

  useEscape(onClose);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [task.title]);

  return (
    <div className="drawer-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Task: ${task.title}`}
        tabIndex={-1}
      >
        <header className="drawer-head">
          <CheckCircle checked={task.done} onChange={() => toggleDone(task.id)} label={task.done ? 'Mark as not done' : 'Mark as done'} size={24} />
          <textarea
            ref={titleRef}
            className="drawer-title"
            rows={1}
            value={task.title}
            aria-label="Task title"
            onChange={(e) => updateTask(task.id, { title: e.target.value.replace(/\n/g, ' ') })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
          />
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close task">
            <X size={18} />
          </button>
        </header>

        <div className="drawer-body">
          <dl className="props">
            <dt>Day</dt>
            <dd>
              <input
                type="date"
                className="field"
                aria-label="Day"
                value={task.date ?? ''}
                onChange={(e) => updateTask(task.id, { date: e.target.value || null })}
              />
              <div className="row wrap">
                {task.date !== today && (
                  <button type="button" className="btn btn-quiet" onClick={() => updateTask(task.id, { date: today })}>
                    Today
                  </button>
                )}
                {task.date !== addDays(today, 1) && (
                  <button type="button" className="btn btn-quiet" onClick={() => updateTask(task.id, { date: addDays(today, 1) })}>
                    Tomorrow
                  </button>
                )}
                {task.date !== null && (
                  <button type="button" className="btn btn-quiet" onClick={() => updateTask(task.id, { date: null })}>
                    Backlog
                  </button>
                )}
              </div>
            </dd>

            {task.date !== null && (
              <>
                <dt>Starts at</dt>
                <dd>
                  <input
                    type="time"
                    className="field"
                    aria-label="Start time"
                    step={300}
                    value={task.start === null ? '' : fmtClock(task.start)}
                    onChange={(e) => updateTask(task.id, { start: e.target.value ? parseClock(e.target.value) : null })}
                  />
                  {task.start !== null && (
                    <label className="check-row" title="A fixed time is never moved by Fill my day, does not count as work, and does not roll over.">
                      <input type="checkbox" checked={Boolean(task.fixed)} onChange={(e) => updateTask(task.id, { fixed: e.target.checked })} />
                      Fixed, like a meeting
                    </label>
                  )}
                </dd>
              </>
            )}

            <dt>Estimate</dt>
            <dd>
              <EstimateChip value={task.planned} onChange={(planned) => updateTask(task.id, { planned })} />
            </dd>

            <dt>Time spent</dt>
            <dd>
              <DurationInput
                label="Time spent"
                minutes={seconds / 60}
                onChange={(min) => updateTask(task.id, { actualSec: Math.round((min ?? 0) * 60) })}
              />
            </dd>

            <dt>Repeats</dt>
            <dd>
              <select
                className="field"
                aria-label="Repeats"
                value={task.repeat ?? ''}
                onChange={(e) => updateTask(task.id, { repeat: (e.target.value || null) as Repeat | null, repeatFrom: e.target.value ? task.date : null })}
              >
                <option value="">Never</option>
                <option value="daily">Every day</option>
                <option value="weekdays">Every weekday</option>
                <option value="weekly">Every week</option>
              </select>
              {task.repeat && <span className="muted hint">Upcoming days show a preview. Each one becomes real when you finish the one before it.</span>}
            </dd>

            <dt>Channel</dt>
            <dd>
              <select className="field" aria-label="Channel" value={task.channelId ?? ''} onChange={(e) => updateTask(task.id, { channelId: e.target.value || null })}>
                <option value="">None</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </dd>

            {objectives.length > 0 && (
              <>
                <dt>Objective</dt>
                <dd>
                  <select
                    className="field"
                    aria-label="Weekly objective"
                    value={task.objectiveId ?? ''}
                    onChange={(e) => updateTask(task.id, { objectiveId: e.target.value || null })}
                  >
                    <option value="">None</option>
                    {objectives.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title}
                      </option>
                    ))}
                  </select>
                </dd>
              </>
            )}
          </dl>

          <h4>Steps</h4>
          <ul className="subtasks">
            {task.subtasks.map((s) => (
              <li key={s.id} className={s.done ? 'is-done' : ''}>
                <CheckCircle checked={s.done} onChange={() => updateSubtask(task.id, s.id, { done: !s.done })} label={`Step: ${s.title}`} size={18} />
                <input className="sub-title" value={s.title} aria-label="Step title" onChange={(e) => updateSubtask(task.id, s.id, { title: e.target.value })} />
                <button type="button" className="icon-btn row-x" aria-label={`Delete step ${s.title}`} onClick={() => deleteSubtask(task.id, s.id)}>
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
          <AddLine placeholder="Add a step" label="Add a step" onAdd={(t) => addSubtask(task.id, t)} />

          <h4>Notes</h4>
          <textarea
            className="field notes"
            value={task.notes}
            aria-label="Notes"
            placeholder="Links, context, what done looks like"
            onChange={(e) => updateTask(task.id, { notes: e.target.value })}
          />
        </div>

        <footer className="drawer-foot">
          {!task.done && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                startTimer(task.id);
                focusOn(task.id);
              }}
            >
              <Play size={14} fill="currentColor" />
              Focus on this
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-quiet btn-danger" onClick={() => deleteWithUndo(task.id)}>
            <Trash2 size={14} />
            Delete
          </button>
        </footer>
      </div>
    </div>
  );
}
