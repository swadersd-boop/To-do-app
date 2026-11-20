import { useMemo, useRef, useState } from 'react';
import { ArrowUp, Copy, Link2, Plus, Trash2 } from 'lucide-react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Task } from '../types';
import { breaksOf, useStore } from '../store';
import { useUI } from '../ui';
import { addFromText, copyText, deferOne, deleteWithUndo, moveToTomorrow, nameTasks } from '../actions';
import { planDay as planBlocks, byTime, estimateUsedUp, freeMinutes, leftOf, tasksOn } from '../lib/model';
import { addDays, longDate, nextWorkday, relativeDay, weekStart, weekdayName } from '../lib/dates';
import { fmtClock, fmtMin } from '../lib/time';
import { fixedTotal, paceOf, weekSummary, workDone, workLeft } from '../lib/stats';
import { partlyText, planText } from '../lib/summary';
import { CalendarButton, importedWhen } from './CalendarImport';
import { encodePlan } from '../lib/share';
import { AddLine, ChannelPill, Dialog, EstimateChip, LoadBar } from './bits';
import { ObjectiveList } from './Objectives';

const DAY_STEPS = ['Leftovers', 'Choose', 'Fit', 'Commit'] as const;
type StepName = 'Week' | (typeof DAY_STEPS)[number];

export function Stepper({ steps, step }: { steps: readonly string[]; step: number }) {
  return (
    <ol className="stepper" aria-label="Progress">
      {steps.map((name, i) => (
        <li key={name} className={i === step ? 'is-current' : i < step ? 'is-past' : ''} aria-current={i === step ? 'step' : undefined}>
          <span className="step-num">{i + 1}</span>
          <span className="step-name">{name}</span>
        </li>
      ))}
    </ol>
  );
}

function Row({ task, children }: { task: Task; children: React.ReactNode }) {
  const updateTask = useStore((s) => s.updateTask);
  return (
    <li className="ritual-row">
      <div className="ritual-row-main">
        <span className="ritual-row-title">{task.title}</span>
        <span className="row">
          <ChannelPill channelId={task.channelId} />
          {task.rolled > 0 && !task.done && (
            <span className={`meta ${task.rolled >= 3 ? 'meta-warn' : ''}`}>moved on {task.rolled === 1 ? 'once' : `${task.rolled} times`}</span>
          )}
          {task.actualSec >= 60 && !estimateUsedUp(task) && <span className="meta">{fmtMin(task.actualSec / 60)} done</span>}
          {estimateUsedUp(task) && (
            <span className="meta meta-warn">
              {fmtMin(task.actualSec / 60)} done, past the estimate. How much is left?
            </span>
          )}
        </span>
      </div>
      <EstimateChip
        value={estimateUsedUp(task) ? null : task.left ? Math.round(leftOf(task) ?? 0) : task.planned}
        onChange={(min) =>
          // Past its estimate (or once you have said), the number is the time still needed; the estimate stays.
          estimateUsedUp(task) || task.left ? min !== null && useStore.getState().setLeft(task.id, min) : updateTask(task.id, { planned: min })
        }
      />
      <div className="row">{children}</div>
    </li>
  );
}

export function PlanRitual() {
  const today = useUI((s) => s.today);
  const close = () => useUI.getState().openModal(null);
  const notify = useUI((s) => s.notify);
  const tasks = useStore((s) => s.tasks);
  const channels = useStore((s) => s.channels);
  const settings = useStore((s) => s.settings);
  const allObjectives = useStore((s) => s.objectives);
  const saved = useStore((s) => s.days[today]);
  const { sendTo, setDay, autoSchedule, moveTask, addObjective } = useStore.getState();

  // The first plan of a week starts with a look back at last week and objectives for this one.
  const days = useStore((s) => s.days);
  const thisWeek = weekStart(today);
  const lastWeek = addDays(thisWeek, -7);
  const [withWeek] = useState(() => {
    const plannedThisWeek = Object.entries(days).some(([d, log]) => d >= thisWeek && d < today && log.plannedAt);
    const hadLastWeek = tasks.some((t) => t.date !== null && t.date >= lastWeek && t.date < thisWeek) || allObjectives.some((o) => o.weekStart === lastWeek);
    return !plannedThisWeek && !saved?.plannedAt && hadLastWeek;
  });
  const STEPS: StepName[] = withWeek ? ['Week', ...DAY_STEPS] : [...DAY_STEPS];
  const [step, setStep] = useState(0);
  const name = STEPS[step];
  const review = useMemo(() => weekSummary(tasks, days, allObjectives, lastWeek), [tasks, days, allObjectives, lastWeek]);
  const lastObjectives = allObjectives.filter((o) => o.weekStart === lastWeek);
  const reflections = Object.entries(days)
    .filter(([d, log]) => d >= lastWeek && d < thisWeek && log.reflection)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const [intention, setIntention] = useState(saved?.intention ?? '');
  const [fill, setFill] = useState(true);
  /** Tasks left out of the share link, such as personal ones. */
  const [unshared, setUnshared] = useState<Set<string>>(new Set());
  const [choosing, setChoosing] = useState(false);

  const todays = useMemo(() => tasksOn(tasks, today), [tasks, today]);
  const open = todays.filter((t) => !t.done);
  const backlog = useMemo(() => tasksOn(tasks, null), [tasks]);
  const leftovers = useMemo(
    () => tasks.filter((t) => !t.done && !t.fixed && ((t.date === today && t.rolled > 0) || (t.date !== null && t.date < today))),
    [tasks, today],
  );
  const objectives = allObjectives.filter((o) => o.weekStart === weekStart(today) && !o.done);
  const stuck = leftovers.filter((t) => t.rolled >= 3);
  const meetings = byTime(open.filter((t) => t.fixed && t.start !== null));
  // Tasks the rollover sent to the backlog this morning, after moving on too many times.
  const parked = tasks.filter((t) => t.date === null && t.parkedOn === today);
  // Tasks put off go to the next working day: Monday after a Friday, unless weekends are on.
  const nextLabel = relativeDay(nextWorkday(today, Boolean(settings.weekendRollover)), today);
  /** The same day inside a sentence: "tomorrow", or "Monday" after a Friday. */
  const nextName = nextLabel === 'Tomorrow' ? 'tomorrow' : nextLabel;
  const [deferRest, setDeferRest] = useState(true);
  /** How many tasks were typed in during this plan, so each new one goes below the last. */
  const added = useRef(0);

  // What the open to-dos still need: estimates minus time already tracked, at your measured pace if you choose.
  const pace = useMemo(() => paceOf(tasks), [tasks]);
  const atPace = settings.planAtPace !== false;
  const setAtPace = (on: boolean) => useStore.getState().setSettings({ planAtPace: on });
  const usePace = atPace && pace !== null ? pace : undefined;
  // The same measure the timeline uses: what each task still needs, rounded the same way.
  const estimated = workLeft(open);
  const atRealPace = pace ? workLeft(open, pace) : estimated;
  const planned = usePace ? atRealPace : estimated;
  // Work already done today comes off the day's capacity, measured as time actually spent.
  const doneToday = workDone(todays, saved);
  const fixed = fixedTotal(open);
  const missing = open.filter((t) => t.planned === null).length;

  // Planning late in the day compares against the time that is actually left.
  const clock = new Date();
  const nowMin = clock.getHours() * 60 + clock.getMinutes();
  const from = Math.max(nowMin, settings.dayStart * 60);
  const until = settings.dayEnd * 60;
  const breaks = breaksOf(settings);
  const capacityLeft = Math.max(0, settings.capacityMin - doneToday);
  const clockLeft = freeMinutes(open, from, until, breaks);
  const available = Math.min(capacityLeft, clockLeft);
  // Late means the clock, not the work already done, is what limits the rest of the day.
  const late = clockLeft < capacityLeft;
  const over = planned - available;

  // What "Start my day" would do, so nothing is dropped by surprise.
  // The same rule "Start my day" uses: no more work than the day's capacity, and only the time that is left.
  const budget = Math.max(0, Math.round(settings.capacityMin - doneToday));
  const placements = useMemo(() => planBlocks(open, from, until, breaks, budget, usePace, today), [open, from, until, breaks, budget, usePace, today]);
  const preview = useMemo(
    () => Object.fromEntries(Object.entries(placements).map(([id, p]) => [id, p ? p.blocks[0].start : null])) as Record<string, number | null>,
    [placements],
  );
  // A task past its estimate is not left out for lack of room: it waits for a new estimate.
  const wontFit = fill ? open.filter((t) => preview[t.id] === null && !estimateUsedUp(t)) : [];
  // Long tasks that only partly fit: how much of each gets booked today.
  const partly = fill
    ? open
        .filter((t) => placements[t.id]?.partial)
        .map((t) => ({ task: t, minutes: placements[t.id]!.blocks.reduce((sum, b) => sum + b.end - b.start, 0), need: placements[t.id]!.need ?? 0 }))
    : [];
  // The plan as it will be: what does not fit is left out of it.
  const ordered = byTime(
    open.filter((t) => !(deferRest && wontFit.includes(t))).map((t) => (fill && !t.fixed ? { ...t, start: preview[t.id] ?? null } : t)),
  );
  const summary = planText(today, ordered, channels, intention, usePace, Object.fromEntries(partly.map((p) => [p.task.id, p.minutes])));

  const finish = () => {
    setDay(today, { plannedAt: new Date().toISOString(), intention: intention.trim() });
    const left = fill ? autoSchedule(today, nowMin, usePace).left : [];
    close();
    if (left.length === 0) return notify('Day planned. Go do the first thing.');
    if (deferRest) return moveToTomorrow(left.map((t) => t.id), 'Day planned.', true);
    notify(
      `Day planned. ${nameTasks(left)} ${left.length === 1 ? 'does' : 'do'} not fit today.`,
      { label: `Move to ${nextName}`, run: () => moveToTomorrow(left.map((t) => t.id)) },
    );
  };

  const share = async () => {
    const hash = await encodePlan({
      name: settings.name,
      date: today,
      intention: intention.trim(),
      // Share the plan as it reads on screen, including the times "Start my day" is about to give.
      tasks: byTime([...todays.filter((t) => t.done), ...ordered].filter((t) => !unshared.has(t.id))).map((t) => {
        const c = channels.find((x) => x.id === t.channelId);
        return { title: t.title, planned: t.planned, done: t.done, channel: c?.name ?? null, color: c?.color ?? null, start: t.start };
      }),
    });
    await copyText(`${location.origin}${location.pathname}${hash}`, 'Link copied. Anyone with it can read this plan.');
  };

  const footer = (
    <>
        {step > 0 && (
          <button type="button" className="btn" onClick={() => setStep(step - 1)}>
            <ArrowLeft size={14} />
            Back
          </button>
        )}
        <span className="spacer" />
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn btn-primary" onClick={() => setStep(step + 1)}>
            Next
            <ArrowRight size={14} />
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={finish}>
            Start my day
          </button>
        )}
    </>
  );

  return (
    <Dialog
      title={`Plan ${longDate(today)}`}
      onClose={close}
      wide
      className="ritual"
      top={<Stepper steps={STEPS} step={step} />}
      footer={footer}
      scrollKey={step}
    >

      {name === 'Week' && (
        <div className="ritual-step">
          <h3>A new week</h3>
          <p className="lede">
            Last week you finished {review.done} task{review.done === 1 ? '' : 's'}
            {review.tracked >= 1 && ` and worked ${fmtMin(review.tracked)}`}
            {review.leftOver > 0 && `, with ${review.leftOver} still open at the end`}.
          </p>
          {lastObjectives.length > 0 && (
            <>
              <h4>Last week's objectives</h4>
              <ul className="ritual-list">
                {lastObjectives.map((o) => {
                  const carried = allObjectives.some((x) => x.weekStart === thisWeek && x.title === o.title);
                  return (
                    <li key={o.id} className={`ritual-row ${o.done ? 'is-done' : ''}`}>
                      <span className={`week-mark ${o.done ? 'is-done' : ''}`} aria-hidden="true">
                        {o.done ? '✓' : '·'}
                      </span>
                      <div className="ritual-row-main">
                        <span className="ritual-row-title">{o.title}</span>
                        <span className="muted hint">{o.done ? 'Done' : 'Not done'}</span>
                      </div>
                      {!o.done && (
                        <button type="button" className="btn btn-quiet" disabled={carried} onClick={() => addObjective(o.title, thisWeek)}>
                          {carried ? 'Carried to this week' : 'Carry to this week'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {reflections.length > 0 && (
            <details className="recap">
              <summary>What you wrote at the end of each day</summary>
              {reflections.map(([d, log]) => (
                <p key={d}>
                  <span>{weekdayName(d)}</span>
                  {log.reflection}
                </p>
              ))}
            </details>
          )}
          <h4>This week's objectives</h4>
          <ObjectiveList week={thisWeek} />
        </div>
      )}

      {name === 'Leftovers' && (
        <div className="ritual-step">
          <h3>Start with what is left over</h3>
          {parked.length > 0 && (
            <div className="wont-fit">
              <p>
                {parked.length === 1 ? 'This went' : `These ${parked.length} went`} to the backlog overnight, after moving on {settings.parkAfter ?? 3} times without being done:
              </p>
              <ul className="ritual-list">
                {parked.map((t) => (
                  <Row key={t.id} task={t}>
                    <button type="button" className="btn btn-quiet" onClick={() => useStore.getState().bringBack(t.id, today)}>
                      Bring back to today
                    </button>
                  </Row>
                ))}
              </ul>
            </div>
          )}
          {leftovers.length === 0 ? (
            <p className="lede">{parked.length > 0 ? 'Nothing else was carried over.' : 'Clean slate. Nothing was carried over from earlier days.'}</p>
          ) : (
            <>
              <p className="lede">These did not get done. Decide on each one before adding anything new.</p>
              {stuck.length > 0 && (
                <p className="row wrap wont-fit">
                  <span>
                    {stuck.length === 1 ? 'One task has' : `${stuck.length} tasks have`} moved on three times or more. Perhaps {stuck.length === 1 ? 'it belongs' : 'they belong'} in the backlog.
                  </span>
                  <button type="button" className="btn" onClick={() => stuck.forEach((t) => sendTo(t.id, null))}>
                    Send {stuck.length === 1 ? 'it' : 'them'} to the backlog
                  </button>
                </p>
              )}
              <ul className="ritual-list">
                {leftovers.map((t) => (
                  <Row key={t.id} task={t}>
                    {t.date !== today && (
                      <button type="button" className="btn btn-quiet" onClick={() => sendTo(t.id, today)}>
                        Today
                      </button>
                    )}
                    <button type="button" className="btn btn-quiet" onClick={() => deferOne(t.id)}>
                      {nextLabel}
                    </button>
                    <button type="button" className="btn btn-quiet" onClick={() => sendTo(t.id, null)}>
                      Backlog
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Delete ${t.title}`} onClick={() => deleteWithUndo(t.id)}>
                      <Trash2 size={14} />
                    </button>
                  </Row>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {name === 'Choose' && (
        <div className="ritual-step">
          <h3>What do you want to get done today?</h3>
          <div className="ritual-cols">
            <div>
              <h4>Today ({open.filter((t) => !t.fixed).length})</h4>
              {meetings.length > 0 && (
                <p className="muted hint">
                  Meetings, which keep their time: {meetings.map((t) => `${t.title} ${fmtClock(t.start!)}`).join(', ')}
                </p>
              )}
              {(saved?.allDay?.length ?? 0) > 0 && (
                <p className="hint meta-warn">All day today: {[...new Set(saved!.allDay!.map((x) => x.title))].join(', ')}</p>
              )}
              <p className="muted hint row wrap">
                {settings.calendarImport
                  ? `Meetings from ${settings.calendarImport.name}, imported ${importedWhen(settings.calendarImport.at)}.`
                  : 'Meetings in your calendar? Bring them in from an .ics file.'}
                <CalendarButton label={settings.calendarImport ? 'Import again' : 'Import a calendar file'} quiet />
              </p>
              <AddLine placeholder="Add a task, e.g. Review deck 30m #work" label="Add a task to today" onAdd={(t) => {
                  // New work goes above the leftovers, in the order it is typed.
                  const id = addFromText(t, today, true);
                  const typed = id ? useStore.getState().tasks.find((x) => x.id === id) : undefined;
                  // A meeting finds its own place by its time; only to-dos take the next spot in the list.
                  if (id && !(typed?.fixed && typed.start !== null)) {
                    // Meetings sit at the top of the day by time, so count from below them.
                    const meetingsFirst = tasksOn(useStore.getState().tasks, today).filter((x) => x.fixed && x.start !== null).length;
                    useStore.getState().moveTask(id, today, meetingsFirst + added.current);
                    added.current += 1;
                  }
                }}
        quick />
              <ul className="ritual-list">
                {open.filter((t) => !t.fixed).map((t) => (
                  <Row key={t.id} task={t}>
                    <button type="button" className="btn btn-quiet" onClick={() => sendTo(t.id, null)}>
                      Not today
                    </button>
                  </Row>
                ))}
                {open.length === 0 && <li className="side-empty">Nothing yet. Add a task or pull one in from the backlog.</li>}
              </ul>
            </div>
            <div>
              {objectives.length > 0 && (
                <>
                  <h4>This week you wanted to</h4>
                  <ul className="plain-list">
                    {objectives.map((o) => (
                      <li key={o.id}>{o.title}</li>
                    ))}
                  </ul>
                </>
              )}
              <h4>Backlog ({backlog.length})</h4>
              <ul className="ritual-list">
                {backlog.map((t) => (
                  <li key={t.id} className="ritual-row">
                    <div className="ritual-row-main">
                      <span className="ritual-row-title">{t.title}</span>
                      <ChannelPill channelId={t.channelId} />
                    </div>
                    <button type="button" className="btn btn-quiet" onClick={() => useStore.getState().bringBack(t.id, today)} aria-label={`Add ${t.title} to today`}>
                      <Plus size={14} />
                      Today
                    </button>
                  </li>
                ))}
                {backlog.length === 0 && <li className="side-empty">The backlog is empty.</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      {name === 'Fit' && (
        <div className="ritual-step">
          <h3>{late ? 'Does it fit in what is left of today?' : 'Does it fit in one day?'}</h3>
          <div className="fit">
            <div className="fit-num">
              <strong className={over > 0 ? 'is-over' : ''}>{fmtMin(planned)}</strong>
              <span>
                {usePace ? 'of work at your pace' : 'of work planned'}, {late ? `with ${fmtMin(available)} left today` : `of ${fmtMin(available)}`}
                {fixed > 0 && `, plus ${fmtMin(fixed)} of fixed commitments`}
              </span>
            </div>
            <LoadBar planned={planned} capacity={available} />
            <p className={`fit-verdict ${over > 0 ? 'is-over' : ''}`}>
              {open.length === 0
                ? 'Nothing is planned yet. Go back and pick at least one thing.'
                : over > 0
                  ? `That is ${fmtMin(over)} more than fits. Move something out before you start.`
                  : `It fits, with ${fmtMin(-over)} to spare.`}
              {missing > 0 && ` ${missing} task${missing === 1 ? ' has' : 's have'} no estimate yet.`}
            </p>
            {pace !== null && Math.abs(estimated - atRealPace) >= 10 && (
              <label className="check-row fit-forecast">
                <input type="checkbox" checked={atPace} onChange={(e) => setAtPace(e.target.checked)} />
                <span>
                  Plan at my real pace. Your estimates add up to {fmtMin(estimated)}; going by your tracked time this is closer to{' '}
                  <strong>{fmtMin(atRealPace)}</strong>, and the timeline books that.
                </span>
              </label>
            )}
          </div>
          <p className="muted">The order below is your priority. Kalm schedules from the top, so if the day runs out, the bottom drops off.</p>
          <ul className="ritual-list">
            {open.filter((t) => !t.fixed).map((t, i) => (
              <Row key={t.id} task={t}>
                {i > 0 && (
                  <button type="button" className="icon-btn" aria-label={`Move ${t.title} to the top`} title="Do this first" onClick={() => moveTask(t.id, today, 0)}>
                    <ArrowUp size={15} />
                  </button>
                )}
                <button type="button" className="btn btn-quiet" onClick={() => deferOne(t.id)}>
                  {nextLabel}
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => sendTo(t.id, null)}>
                  Backlog
                </button>
              </Row>
            ))}
          </ul>
        </div>
      )}

      {name === 'Commit' && (
        <div className="ritual-step">
          <h3>Commit to the day</h3>
          <label className="stack">
            <span>If only one thing goes well today, what should it be?</span>
            <input className="field" value={intention} onChange={(e) => setIntention(e.target.value)} placeholder="One sentence" autoFocus />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} />
            Put the tasks on my timeline from {fmtClock(from)}, around meetings{breaks.length > 0 ? ' and lunch' : ''}
          </label>
          {partly.length > 0 && (
            <p className="muted">
              {partly.map(partlyText).join(' ')}
            </p>
          )}
          {wontFit.length > 0 && (
            <div className="wont-fit">
              <p className="row wrap wont-fit-head">
                <span>
                {wontFit.length === 1 ? 'This does' : `These ${wontFit.length} do`} not fit in {late ? 'what is left of today' : `your ${fmtMin(settings.capacityMin)} of work`}:
              </span>
                {wontFit.length > 1 && (
                  <button type="button" className="btn" onClick={() => moveToTomorrow(wontFit.map((t) => t.id))}>
                    Move all to {nextName}
                  </button>
                )}
              </p>
              <ul className="ritual-list">
                {wontFit.map((t) => (
                  <Row key={t.id} task={t}>
                    <button type="button" className="btn btn-quiet" onClick={() => deferOne(t.id)}>
                      {nextLabel}
                    </button>
                    <button type="button" className="btn btn-quiet" onClick={() => sendTo(t.id, null)}>
                      Backlog
                    </button>
                  </Row>
                ))}
              </ul>
            </div>
          )}
          {wontFit.length > 0 && (
            <label className="check-row">
              <input type="checkbox" checked={deferRest} onChange={(e) => setDeferRest(e.target.checked)} />
              Move what does not fit to {nextName} when I start my day
            </label>
          )}
          <h4>Your plan</h4>
          <pre className="summary">{summary}</pre>
          <div className="row wrap">
            <button type="button" className="btn" onClick={() => copyText(summary, 'Plan copied')}>
              <Copy size={14} />
              Copy as text
            </button>
            <button type="button" className="btn" onClick={share}>
              <Link2 size={14} />
              Copy a share link
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setChoosing(!choosing)} aria-expanded={choosing}>
              {unshared.size > 0 ? `Sharing ${todays.length - unshared.size} of ${todays.length}` : 'Choose what to share'}
            </button>
          </div>
          {choosing && (
            <ul className="share-pick">
              {byTime(todays).map((t) => (
                <li key={t.id}>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={!unshared.has(t.id)}
                      onChange={() => {
                        const next = new Set(unshared);
                        if (next.has(t.id)) next.delete(t.id);
                        else next.add(t.id);
                        setUnshared(next);
                      }}
                    />
                    {t.title}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

    </Dialog>
  );
}
