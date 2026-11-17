import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { ISODate } from '../types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { addFromText } from '../actions';
import { occursOn, tasksOn } from '../lib/model';
import { isWeekend, relativeDay, shortDate, weekdayName } from '../lib/dates';
import { fmtMin } from '../lib/time';
import { actualTotal, fixedTotal, workTotal } from '../lib/stats';
import { AddLine, LoadBar } from './bits';
import { GhostCard, TaskCard } from './TaskCard';

export const dayContainerId = (date: ISODate | null) => (date === null ? 'list:backlog' : `list:${date}`);

export function DayColumn({ date, addRef }: { date: ISODate; addRef?: React.Ref<HTMLInputElement> }) {
  const tasks = useStore((s) => s.tasks);
  const capacity = useStore((s) => s.settings.capacityMin);
  const log = useStore((s) => s.days[date]);
  const today = useUI((s) => s.today);
  const selected = useUI((s) => s.selectedDay === date);
  const selectDay = useUI((s) => s.selectDay);

  const list = useMemo(() => tasksOn(tasks, date), [tasks, date]);
  const isToday = date === today;
  const isPast = date < today;
  // Repeating tasks that will land on this day once their current occurrence is finished.
  const ghosts = useMemo(
    () => (isPast || isToday ? [] : tasks.filter((t) => occursOn(t, date) && !list.some((x) => x.title === t.title && x.repeat === t.repeat))),
    [tasks, list, date, isPast, isToday],
  );
  const open = list.filter((t) => !t.done);
  const upcoming = [...open, ...ghosts];
  const planned = workTotal(upcoming);
  const fixed = fixedTotal(upcoming);
  const doneCount = list.length - open.length;
  const over = planned - capacity;
  const empty = list.length === 0 && ghosts.length === 0;

  const { setNodeRef, isOver } = useDroppable({ id: dayContainerId(date), data: { type: 'list', date } });
  const label = relativeDay(date, today);

  return (
    <section
      className={`col ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''} ${selected ? 'is-selected' : ''} ${isWeekend(date) ? 'is-weekend' : ''}`}
      aria-label={`${label}, ${shortDate(date)}`}
      data-date={date}
    >
      <button type="button" className="col-head" onClick={() => selectDay(date)} aria-pressed={selected} title="Show this day on the timeline">
        <span className="col-name">
          {label}
          {log?.shutdownAt && <span className="col-flag">closed</span>}
        </span>
        <span className="col-date">
          {label === weekdayName(date) ? shortDate(date) : `${weekdayName(date, 'short')} ${shortDate(date)}`}
        </span>
      </button>

      <div className="col-load">
        <LoadBar planned={planned} capacity={capacity} />
        <span className={`col-load-text ${over > 0 ? 'is-over' : ''}`}>
          {empty
            ? 'Nothing planned'
            : isPast
              ? `${doneCount} done${actualTotal(list) >= 1 ? ` · ${fmtMin(actualTotal(list))} tracked` : ''}`
              : over > 0
                ? `${fmtMin(planned)} of work, ${fmtMin(over)} over`
                : `${fmtMin(planned)} of ${fmtMin(capacity)}`}
          {!isPast && fixed > 0 && ` · ${fmtMin(fixed)} fixed`}
          {!isPast && doneCount > 0 && ` · ${doneCount} done`}
          {isPast && (log?.carried ?? 0) > 0 && ` · ${log!.carried} carried over`}
        </span>
      </div>

      {(log?.intention || log?.reflection) && !isToday && (
        <details className="recap">
          <summary>Notes from this day</summary>
          {log.intention && (
            <p>
              <span>Focus</span>
              {log.intention}
            </p>
          )}
          {log.reflection && (
            <p>
              <span>Reflection</span>
              {log.reflection}
            </p>
          )}
        </details>
      )}

      <AddLine
        inputRef={addRef}
        placeholder={isToday ? 'Try: Email Sam 15m #work' : 'Add a task'}
        label={`Add a task to ${label}`}
        onAdd={(text) => addFromText(text, date)}
        quick
      />

      <SortableContext items={list.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className={`col-list ${isOver ? 'is-over' : ''}`}>
          {list.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
          {ghosts.map((t) => (
            <GhostCard key={`ghost-${t.id}`} task={t} />
          ))}
          {empty && <li className="col-empty">{isPast ? 'Nothing was finished this day.' : 'Drop a task here.'}</li>}
        </ul>
      </SortableContext>
    </section>
  );
}
