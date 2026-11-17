import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy } from 'lucide-react';
import { useStore } from '../store';
import { useUI } from '../ui';
import { copyText } from '../actions';
import { tasksOn } from '../lib/model';
import { addDays, longDate } from '../lib/dates';
import { fmtMin } from '../lib/time';
import { todaySec, trackedOn, workTotal } from '../lib/stats';
import { fmtClock } from '../lib/time';
import { shutdownText } from '../lib/summary';
import { ChannelPill, CheckCircle, Dialog, DurationInput } from './bits';
import { Stepper } from './PlanRitual';

const STEPS = ['Review', 'Reflect', 'Close'] as const;

export function ShutdownRitual() {
  const today = useUI((s) => s.today);
  const close = () => useUI.getState().openModal(null);
  const notify = useUI((s) => s.notify);
  const tasks = useStore((s) => s.tasks);
  const channels = useStore((s) => s.channels);
  const saved = useStore((s) => s.days[today]);
  const { sendTo, setDay, toggleDone, updateTask, stopTimer } = useStore.getState();

  const [step, setStep] = useState(0);
  const [reflection, setReflection] = useState(saved?.reflection ?? '');

  const todays = useMemo(() => tasksOn(tasks, today), [tasks, today]);
  // Meetings are not to-dos: they are not "not done", and they never move to tomorrow.
  const done = todays.filter((t) => t.done && !t.fixed);
  const open = todays.filter((t) => !t.done && !t.fixed);
  const ahead = todays.filter((t) => !t.done && t.fixed && t.start !== null);
  const tomorrow = addDays(today, 1);
  // Unfinished to-dos carry over on their own, so they are part of tomorrow's list too.
  const tomorrowCount = tasks.filter((t) => t.date === tomorrow && !t.done).length + open.length;
  const planned = workTotal(todays);
  const actual = trackedOn(todays);
  const summary = shutdownText(today, todays, channels, reflection);

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
                        minutes={todaySec(t) / 60}
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
              <p className="lede">These move to tomorrow on their own. Send anything that can wait to the backlog instead.</p>
              <ul className="ritual-list">
                {open.map((t) => (
                  <li key={t.id} className="ritual-row">
                    <CheckCircle checked={false} onChange={() => toggleDone(t.id)} label={`Mark ${t.title} as done`} size={18} />
                    <div className="ritual-row-main">
                      <span className="ritual-row-title">{t.title}</span>
                      <ChannelPill channelId={t.channelId} />
                    </div>
                    <div className="row">
                      <button type="button" className="btn btn-quiet" onClick={() => sendTo(t.id, tomorrow)}>
                        Tomorrow
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
              <strong>{fmtMin(planned)}</strong>
              <span>of work planned</span>
            </div>
            <div>
              <strong>{actual >= 1 ? fmtMin(actual) : 'none'}</strong>
              <span>tracked</span>
            </div>
            <div>
              <strong>{tomorrowCount}</strong>
              <span>on tomorrow's list</span>
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
