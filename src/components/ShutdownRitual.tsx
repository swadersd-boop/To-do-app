import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy } from 'lucide-react';
import { useStore } from '../store';
import { useUI } from '../ui';
import { copyText, deferOne } from '../actions';
import { estimateUsedUp, tasksOn } from '../lib/model';
import { addDays, longDate, nextWorkday, relativeDay, weekStart, weekdayName } from '../lib/dates';
import { paceOf, workDone, workedMin, workLeft } from '../lib/stats';
import { fmtClock, fmtMin } from '../lib/time';
import { shutdownText } from '../lib/summary';
import { ChannelPill, CheckCircle, Dialog, DurationInput, EstimateChip } from './bits';
import { Stepper } from './PlanRitual';

const STEPS = ['Review', 'Reflect', 'Close'] as const;

export function ShutdownRitual() {
  const today = useUI((s) => s.today);
  const close = () => useUI.getState().openModal(null);
  const notify = useUI((s) => s.notify);
  const tasks = useStore((s) => s.tasks);
  const channels = useStore((s) => s.channels);
  const saved = useStore((s) => s.days[today]);
  const parkLimit = useStore((s) => (s.settings.parkAfter === undefined ? 3 : s.settings.parkAfter));
  const { sendTo, setDay, toggleDone, updateTask, stopTimer } = useStore.getState();

  const [step, setStep] = useState(0);
  const [reflection, setReflection] = useState(saved?.reflection ?? '');

  const todays = useMemo(() => tasksOn(tasks, today), [tasks, today]);
  // Meetings are not to-dos: they are not "not done", and they never move to tomorrow.
  const done = todays.filter((t) => t.done && !t.fixed);
  const open = todays.filter((t) => !t.done && !t.fixed);
  const ahead = todays.filter((t) => !t.done && t.fixed && t.start !== null);
  // Leftovers go to the next working day: Monday after a Friday, unless weekends are on.
  const weekends = useStore((s) => Boolean(s.settings.weekendRollover));
  const tomorrow = nextWorkday(today, weekends);
  const nextDay = tomorrow === addDays(today, 1) ? 'tomorrow' : weekdayName(tomorrow);
  // Unfinished to-dos carry over on their own, so they are part of tomorrow's list too.
  // Tasks that go to the backlog tonight are not on tomorrow's list.
  const objectives = useStore((s) => s.objectives);
  // Work for an open objective of this week is never parked, the same rule the rollover uses.
  const kept = new Set(objectives.filter((o) => !o.done && o.weekStart === weekStart(today)).map((o) => o.id));
  const parking = (t: (typeof open)[number]) => parkLimit !== null && t.rolled >= parkLimit && !(t.objectiveId && kept.has(t.objectiveId));
  const tomorrowCount = tasks.filter((t) => t.date === tomorrow && !t.done && !t.fixed).length + open.filter((t) => !parking(t)).length;
  // The same numbers as the day column: worked today, and left at the plan's pace.
  const atPace = useStore((s) => s.settings.planAtPace !== false);
  const pace = useMemo(() => (atPace ? (paceOf(tasks) ?? undefined) : undefined), [tasks, atPace]);
  const left = workLeft(open, pace);
  // Tasks past their estimate add nothing to the number above until someone says what is left.
  const unknown = open.filter(estimateUsedUp).length;
  const actual = workDone(todays, saved);
  const summary = shutdownText(today, todays, channels, reflection, pace, saved);

  const begin = () => {
    stopTimer();
    setStep(1);
  };

  const finish = () => {
    setDay(today, { shutdownAt: new Date().toISOString(), reflection: reflection.trim() });
    close();
    notify('Day closed. Work is done for today.');
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
          <button type="button" className="btn btn-primary" onClick={step === 0 ? begin : () => setStep(step + 1)}>
            Next
            <ArrowRight size={14} />
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={finish}>
            Done for today
          </button>
        )}
    </>
  );

  return (
    <Dialog
      title={`Shut down ${longDate(today)}`}
      onClose={close}
      wide
      className="ritual"
      top={<Stepper steps={STEPS} step={step} />}
      footer={footer}
      scrollKey={step}
    >

      {step === 0 && (
        <div className="ritual-step">
          <h3>What happened today</h3>
          {todays.length === 0 && <p className="lede">Nothing was planned for today.</p>}
          {done.length > 0 && (
            <>
              <h4>Done ({done.length})</h4>
              <ul className="ritual-list">
                {done.map((t) => (
                  <li key={t.id} className="ritual-row">
                    <CheckCircle checked onChange={() => toggleDone(t.id)} label={`Mark ${t.title} as not done`} size={18} />
                    <div className="ritual-row-main">
                      <span className="ritual-row-title">{t.title}</span>
                      <ChannelPill channelId={t.channelId} />
                    </div>
                    <label className="row time-edit">
                      <span>took</span>
                      <DurationInput
                        label={`Time spent on ${t.title}`}
                        // The same number the day counts: timed work, or for untimed work the time its block showed.
                        minutes={workedMin(t)}
                        onChange={(min) => updateTask(t.id, { actualSec: Math.round((min ?? 0) * 60) + (t.trackedBefore ?? 0) })}
                      />
                      {t.planned !== null && <span className="muted">of {fmtMin(t.planned)}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {open.length > 0 && (
            <>
              <h4>Not done ({open.length})</h4>
              <p className="lede">
                {open.some(parking)
                  ? `These move to ${nextDay} on their own, except the ones marked for the backlog. Send anything else that can wait to the backlog too.`
                  : `These move to ${nextDay} on their own. Send anything that can wait to the backlog instead.`}
              </p>
              <ul className="ritual-list">
                {open.map((t) => (
                  <li key={t.id} className="ritual-row">
                    <CheckCircle checked={false} onChange={() => toggleDone(t.id)} label={`Mark ${t.title} as done`} size={18} />
                    <div className="ritual-row-main">
                      <span className="ritual-row-title">{t.title}</span>
                      <span className="row">
                        <ChannelPill channelId={t.channelId} />
                        {parking(t) && <span className="meta meta-warn">goes to the backlog tonight</span>}
                        {estimateUsedUp(t) && (
                          <span className="meta meta-warn">
                            {fmtMin(t.actualSec / 60)} done, past its {fmtMin(t.planned!)} estimate. How much is left?
                          </span>
                        )}
                      </span>
                    </div>
                    {estimateUsedUp(t) && (
                      // The number picked is the time still needed, so tomorrow's plan has something true to go on.
                      <EstimateChip value={null} onChange={(min) => min !== null && useStore.getState().setLeft(t.id, min)} />
                    )}
                    <div className="row">
                      <button type="button" className="btn btn-quiet" onClick={() => deferOne(t.id)}>
                        {relativeDay(tomorrow, today)}
                      </button>
                      <button type="button" className="btn btn-quiet" onClick={() => sendTo(t.id, null)}>
                        Backlog
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {ahead.length > 0 && (
            <p className="muted">
              Still to come today: {ahead.map((t) => `${t.title} at ${fmtClock(t.start!)}`).join(', ')}.
            </p>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="ritual-step">
          <h3>How did it go?</h3>
          <div className="stats">
            <div>
              <strong>{done.length}</strong>
              <span>done</span>
            </div>
            <div>
              <strong>{left >= 1 ? fmtMin(left) : 'none'}</strong>
              <span>
                of work left undone
                {unknown > 0 && `, plus ${unknown} ${unknown === 1 ? 'task' : 'tasks'} past ${unknown === 1 ? 'its' : 'their'} estimate`}
              </span>
            </div>
            <div>
              <strong>{actual >= 1 ? fmtMin(actual) : 'none'}</strong>
              <span>worked</span>
            </div>
            <div>
              <strong>{tomorrowCount}</strong>
              <span>on {nextDay === 'tomorrow' ? "tomorrow's" : `${nextDay}'s`} list</span>
            </div>
          </div>
          <label className="stack">
            <span>What went well, and what would you change?</span>
            <textarea className="field notes" value={reflection} onChange={(e) => setReflection(e.target.value)} placeholder="A few honest lines" autoFocus />
          </label>
        </div>
      )}

      {step === 2 && (
        <div className="ritual-step">
          <h3>Close the day</h3>
          <p className="lede">This is the record of today. Paste it wherever your team reads updates, or keep it for yourself.</p>
          <pre className="summary">{summary}</pre>
          <div className="row">
            <button type="button" className="btn" onClick={() => copyText(summary, 'Recap copied')}>
              <Copy size={14} />
              Copy as text
            </button>
          </div>
        </div>
      )}

    </Dialog>
  );
}
