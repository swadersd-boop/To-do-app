import { useMemo } from 'react';
import { X } from 'lucide-react';
import type { ISODate } from '../types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { addDays, shortDate, weekStart } from '../lib/dates';
import { AddLine, CheckCircle } from './bits';

/** "This week", "Last week", "Next week" or "Week of 2 Nov". */
export function weekLabel(week: ISODate, today: ISODate): string {
  const current = weekStart(today);
  if (week === current) return 'This week';
  if (week === addDays(current, -7)) return 'Last week';
  if (week === addDays(current, 7)) return 'Next week';
  return `Week of ${shortDate(week)}`;
}

/** The objectives of one week, with ticking, linked-task counts, delete with undo, and adding. */
export function ObjectiveList({ week, compact = false }: { week: ISODate; compact?: boolean }) {
  const all = useStore((s) => s.objectives);
  const tasks = useStore((s) => s.tasks);
  const { addObjective, updateObjective, deleteObjective, restoreObjective } = useStore.getState();
  const today = useUI((s) => s.today);
  const objectives = useMemo(() => all.filter((o) => o.weekStart === week), [all, week]);
  const past = addDays(week, 6) < today;

  const remove = (id: string) => {
    const removed = deleteObjective(id);
    if (!removed) return;
    useUI.getState().notify(`Deleted "${removed.objective.title}"`, { label: 'Undo', run: () => restoreObjective(removed.objective, removed.linked) });
  };

  return (
    <>
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
              <button type="button" className="icon-btn row-x" aria-label={`Delete objective ${o.title}`} onClick={() => remove(o.id)}>
                <X size={14} />
              </button>
            </li>
          );
        })}
        {objectives.length === 0 && (
          <li className="side-empty">{past ? 'No objectives were set for this week.' : 'What would make this week a good one?'}</li>
        )}
      </ul>
      {!past && <AddLine placeholder={compact ? 'Add an objective' : 'Add an objective'} label="Add a weekly objective" onAdd={(t) => addObjective(t, week)} />}
    </>
  );
}
