import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Clock, ListChecks, Play, Repeat, RotateCw, Square } from 'lucide-react';
import type { Task } from '../types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { fmtClock } from '../lib/time';
import { ChannelPill, CheckCircle, EstimateChip, useTracked } from './bits';

/** The card body, shared by the sortable card and the drag overlay. */
export function TaskCardView({ task, dragging = false }: { task: Task; dragging?: boolean }) {
  const toggleDone = useStore((s) => s.toggleDone);
  const updateTask = useStore((s) => s.updateTask);
  const startTimer = useStore((s) => s.startTimer);
  const stopTimer = useStore((s) => s.stopTimer);
  const focusOn = useUI((s) => s.focusOn);
  const { seconds, running } = useTracked(task.id, task.actualSec);
  const subDone = task.subtasks.filter((s) => s.done).length;

  return (
    <div className={`card ${task.done ? 'is-done' : ''} ${running ? 'is-running' : ''} ${dragging ? 'is-dragging' : ''}`}>
      <div className="card-top">
        <CheckCircle checked={task.done} onChange={() => toggleDone(task.id)} label={task.done ? 'Mark as not done' : 'Mark as done'} />
        <span className="card-title">{task.title}</span>
        {!task.done && (
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
          <span className="meta">
            <Clock size={12} />
            {fmtClock(task.start)}
          </span>
        )}
        {task.subtasks.length > 0 && (
          <span className="meta">
            <ListChecks size={12} />
            {subDone}/{task.subtasks.length}
          </span>
        )}
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
        <EstimateChip value={task.planned} onChange={(planned) => updateTask(task.id, { planned })} actualMin={seconds / 60} />
      </div>
    </div>
  );
}

export function TaskCard({ task }: { task: Task }) {
  const openTask = useUI((s) => s.openTask);
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
      aria-label={`${task.title}. Press Enter to open, Space to move.`}
      onClick={() => openTask(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault();
          openTask(task.id);
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
    >
      <TaskCardView task={task} />
    </li>
  );
}
