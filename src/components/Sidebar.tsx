import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useStore } from '../store';
import { useUI } from '../ui';
import { addFromText } from '../actions';
import { tasksOn } from '../lib/model';
import { addDays, shortDate, weekStart } from '../lib/dates';
import { AddLine } from './bits';
import { ObjectiveList, weekLabel } from './Objectives';
import { TaskCard } from './TaskCard';
import { dayContainerId } from './DayColumn';

/** The objectives of the week the board is showing. */
function Objectives() {
  const today = useUI((s) => s.today);
  const boardStart = useUI((s) => s.boardStart);
  const week = weekStart(boardStart);
  return (
    <section className="side-section">
      <h3>
        {weekLabel(week, today)}
        <span className="side-sub">
          {shortDate(week)} to {shortDate(addDays(week, 6))}
        </span>
      </h3>
      <ObjectiveList week={week} />
    </section>
  );
}

function Backlog() {
  const tasks = useStore((s) => s.tasks);
  const list = useMemo(() => tasksOn(tasks, null), [tasks]);
  const { setNodeRef, isOver } = useDroppable({ id: dayContainerId(null), data: { type: 'list', date: null } });

  return (
    <section className="side-section side-grow">
      <h3>
        Backlog
        <span className="side-sub">{list.length}</span>
      </h3>
      <AddLine placeholder="Add for later" label="Add a task to the backlog" onAdd={(t) => addFromText(t, null, true)}
        quick />
      <SortableContext items={list.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className={`col-list ${isOver ? 'is-over' : ''}`}>
          {list.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
          {list.length === 0 && <li className="col-empty">Park things here that have no day yet.</li>}
        </ul>
      </SortableContext>
    </section>
  );
}

export function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Objectives and backlog">
      <Objectives />
      <Backlog />
    </aside>
  );
}
