import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Clock, ListChecks, Pin, Play, Repeat, RotateCw, Square } from 'lucide-react';
import type { Task } from '../types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { deleteWithUndo } from '../actions';
import { fmtMin } from '../lib/time';
import { todaySec } from '../lib/stats';
import { blocksOf, estimateUsedUp, leftOf } from '../lib/model';
import { fmtClock } from '../lib/time';
import { ChannelPill, CheckCircle, EstimateChip, useNow, useTracked } from './bits';

/** The card body, shared by the sortable card and the drag overlay. */
export function TaskCardView({ task, dragging = false }: { task: Task; dragging?: boolean }) {
  const toggleDone = useStore((s) => s.toggleDone);
  const updateTask = useStore((s) => s.updateTask);
  const startTimer = useStore((s) => s.startTimer);
  const stopTimer = useStore((s) => s.stopTimer);
  const focusOn = useUI((s) => s.focusOn);
  const { seconds, running } = useTracked(task.id, task.actualSec);
  // On a past day, the card shows the time worked on that day, not on the task in all.
  const isPastDay = useUI((s) => task.date !== null && task.date < s.today);
  const isToday = useUI((s) => task.date === s.today);
  // A split task under way shows when its next block starts, not the first one that is already behind.
  const split = task.start !== null && !task.done && !task.fixed && isToday && Boolean(task.parts?.length);
  const now = useNow(60_000, split);
  // When the plan booked more than the estimate (planning at your pace), say so on the card.
  // Only for work not started yet: once there is tracked time, the timeline shows what happened.
  const booked = isToday && !task.done && !task.fixed && task.start !== null && todaySec(task) < 60 ? blocksOf(task).reduce((sum, b) => sum + b.end - b.start, 0) : 0;
  const byEstimate = leftOf(task);
  const bookedMore = byEstimate !== null && booked - byEstimate >= 10;
  const shownStart = (() => {
    if (!split) return task.start;
    const at = new Date(now);
    const nowMin = at.getHours() * 60 + at.getMinutes();
    return blocksOf(task).find((b) => b.end > nowMin)?.start ?? task.start;
  })();
  const subDone = task.subtasks.filter((s) => s.done).length;

  return (
    <div className={`card ${task.done && !task.unconfirmed ? 'is-done' : ''} ${task.unconfirmed ? 'is-unconfirmed' : ''} ${running ? 'is-running' : ''} ${dragging ? 'is-dragging' : ''}`}>
      <div className="card-top">
        {task.unconfirmed ? (
          <CheckCircle
            checked={false}
            onChange={() => useStore.getState().updateTask(task.id, { unconfirmed: false })}
            label="Its time passed while Kalm was closed. Tick to confirm it took place."
          />
        ) : (
          <CheckCircle checked={task.done} onChange={() => toggleDone(task.id)} label={task.done ? 'Mark as not done' : 'Mark as done'} />
        )}
        <span className="card-title">{task.title}</span>
        {!task.done && !task.fixed && (
          <button
            type="button"
            className="icon-btn card-play"
            aria-label={running ? 'Stop timer' : 'Start focus'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (running) stopTimer();
              else {
                startTimer(task.id);
                focusOn(task.id);
              }
            }}
          >
            {running ? <Square size={13} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </button>
        )}
      </div>
      <div className="card-meta">
        <ChannelPill channelId={task.channelId} />
        {task.start !== null && (
          <span className={`meta ${task.fixed ? 'meta-fixed' : ''}`} title={task.fixed ? 'Fixed time' : 'Planned time'}>
            {task.fixed ? <Pin size={12} /> : <Clock size={12} />}
            {fmtClock(shownStart ?? task.start)}
          </span>
        )}
        {task.left && !task.done && (
          <span className="meta" title="What you said is still needed, past the original estimate">
            {fmtMin(leftOf(task) ?? 0)} left
          </span>
        )}
        {bookedMore && (
          <span className="meta" title="The plan books more than the estimate, going by how long your tasks really take.">
            {fmtMin(booked)} booked
          </span>
        )}
        {task.subtasks.length > 0 && (
          <span className="meta">
            <ListChecks size={12} />
            {subDone}/{task.subtasks.length}
          </span>
        )}
        {task.unconfirmed && <span className="meta" title="Its time passed while Kalm was closed">passed, not confirmed</span>}
        {task.repeat && (
          <span className="meta" title={task.repeat === 'daily' ? 'Repeats every day' : task.repeat === 'weekdays' ? 'Repeats every weekday' : 'Repeats every week'}>
            <Repeat size={11} />
          </span>
        )}
        {task.rolled > 0 && !task.done && (
          <span className="meta meta-warn" title={`Carried over ${task.rolled} time${task.rolled === 1 ? '' : 's'}`}>
            <RotateCw size={11} />
            {task.rolled}
          </span>
        )}
        <span className="spacer" />
        <EstimateChip
          value={task.planned}
          // Past the estimate, the number picked is what is still needed; the estimate stays as it was.
          onChange={(min) => ((estimateUsedUp(task) || task.left) && min !== null ? useStore.getState().setLeft(task.id, min) : updateTask(task.id, { planned: min }))}
          actualMin={(isPastDay ? todaySec(task) : seconds) / 60}
        />
      </div>
    </div>
  );
}

export function TaskCard({ task }: { task: Task }) {
  const openTask = useUI((s) => s.openTask);
  const toggleDone = useStore((s) => s.toggleDone);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', date: task.date },
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      className="card-wrap"
      data-task-id={task.id}
      {...attributes}
      {...listeners}
      role="button"
      aria-label={`${task.title}. Enter opens, X marks done, Space moves, Delete removes.`}
      onClick={() => openTask(task.id)}
      onKeyDown={(e) => {
        // Keys pressed on a button inside the card belong to that button.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          openTask(task.id);
        } else if (e.key === 'x') {
          e.preventDefault();
          e.stopPropagation();
          toggleDone(task.id);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          deleteWithUndo(task.id);
        } else {
          listeners?.onKeyDown?.(e);
        }
      }}
    >
      <TaskCardView task={task} />
    </li>
  );
}

/** A not-yet-real occurrence of a repeating task, shown on the days it will come up. */
export function GhostCard({ task }: { task: Task }) {
  return (
    <li className="card card-ghost" title="This repeating task appears here once the current one is finished">
      <div className="card-top">
        <Repeat size={14} className="ghost-icon" />
        <span className="card-title">{task.title}</span>
      </div>
      <div className="card-meta">
        <ChannelPill channelId={task.channelId} />
        {task.fixed && task.start !== null && (
          <span className="meta">
            <Pin size={12} />
            {fmtClock(task.start)}
          </span>
        )}
        <span className="spacer" />
        {task.planned !== null && <span className="chip">{fmtMin(task.planned)}</span>}
      </div>
    </li>
  );
}
