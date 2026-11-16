import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { X } from 'lucide-react';
import { useStore } from '../store';
import { useUI } from '../ui';
import { addFromText } from '../actions';
import { tasksOn } from '../lib/model';
import { addDays, shortDate, weekStart } from '../lib/dates';
import { AddLine, CheckCircle } from './bits';
import { TaskCard } from './TaskCard';
import { dayContainerId } from './DayColumn';

function Objectives() {
  const today = useUI((s) => s.today);
  const week = weekStart(today);
  const all = useStore((s) => s.objectives);
  const tasks = useStore((s) => s.tasks);
  const addObjective = useStore((s) => s.addObjective);
  const updateObjective = useStore((s) => s.updateObjective);
  const deleteObjective = useStore((s) => s.deleteObjective);
  const objectives = useMemo(() => all.filter((o) => o.weekStart === week), [all, week]);

  return (
    <section className="side-section">
      <h3>
        This week
        <span className="side-sub">
          {shortDate(week)} to {shortDate(addDays(week, 6))}
        </span>
      </h3>
      <ul className="objectives">
        {objectives.map((o) => {
          const linked = tasks.filter((t) => t.objectiveId === o.id);
          const done = linked.filter((t) => t.done).length;
          return (
            <li key={o.id} className={o.done ? 'is-done' : ''}>
              <CheckCircle checked={o.done} onChange={() => updateObjective(o.id, { done: !o.done })} label={`Objective: ${o.title}`} size={18} />
              <span className="objective-title">{o.title}</span>
              {linked.length > 0 && (
                <span className="meta" title="Linked tasks done">
                  {done}/{linked.length}
                </span>
              )}
              <button type="button" className="icon-btn row-x" aria-label={`Delete objective ${o.title}`} onClick={() => deleteObjective(o.id)}>
                <X size={14} />
              </button>
            </li>
          );
        })}
        {objectives.length === 0 && <li className="side-empty">What would make this week a good one?</li>}
      </ul>
      <AddLine placeholder="Add an objective" label="Add a weekly objective" onAdd={(t) => addObjective(t, week)} />
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
      <AddLine placeholder="Add for later" label="Add a task to the backlog" onAdd={(t) => addFromText(t, null, true)} />
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
