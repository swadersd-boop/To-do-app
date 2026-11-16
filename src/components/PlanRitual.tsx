import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy, Link2, Plus, Trash2 } from 'lucide-react';
import type { Task } from '../types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { addFromText, copyText, deleteWithUndo } from '../actions';
import { tasksOn } from '../lib/model';
import { addDays, longDate, weekStart } from '../lib/dates';
import { fmtMin } from '../lib/time';
import { forecast, plannedTotal } from '../lib/stats';
import { planText } from '../lib/summary';
import { encodePlan } from '../lib/share';
import { AddLine, ChannelPill, Dialog, EstimateChip, LoadBar } from './bits';

const STEPS = ['Leftovers', 'Choose', 'Fit', 'Commit'] as const;

export function Stepper({ steps, step }: { steps: readonly string[]; step: number }) {
  return (
    <ol className="stepper" aria-label="Progress">
      {steps.map((name, i) => (
        <li key={name} className={i === step ? 'is-current' : i < step ? 'is-past' : ''} aria-current={i === step ? 'step' : undefined}>
          <span className="step-num">{i + 1}</span>
          {name}
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
        <ChannelPill channelId={task.channelId} />
      </div>
      <EstimateChip value={task.planned} onChange={(planned) => updateTask(task.id, { planned })} />
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
  const { sendTo, setDay, autoSchedule } = useStore.getState();

  const [step, setStep] = useState(0);
  const [intention, setIntention] = useState(saved?.intention ?? '');
  const [fill, setFill] = useState(true);

  const todays = useMemo(() => tasksOn(tasks, today), [tasks, today]);
  const open = todays.filter((t) => !t.done);
  const backlog = useMemo(() => tasksOn(tasks, null), [tasks]);
  const leftovers = useMemo(
    () => tasks.filter((t) => !t.done && ((t.date === today && t.rolled > 0) || (t.date !== null && t.date < today))),
    [tasks, today],
  );
  const objectives = allObjectives.filter((o) => o.weekStart === weekStart(today) && !o.done);

  const planned = plannedTotal(open);
  const missing = open.filter((t) => t.planned === null).length;
  const likely = forecast(open, tasks);
  const over = planned - settings.capacityMin;
  const tomorrow = addDays(today, 1);
  const summary = planText(today, open, channels, intention);

  const finish = () => {
    setDay(today, { plannedAt: new Date().toISOString(), intention: intention.trim() });
    if (fill) {
      const now = new Date();
      autoSchedule(today, now.getHours() * 60 + now.getMinutes());
    }
    close();
    notify('Day planned. Go do the first thing.');
  };

  const share = async () => {
    const hash = await encodePlan({
      name: settings.name,
      date: today,
      intention: intention.trim(),
      tasks: open.map((t) => {
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

      {step === 0 && (
        <div className="ritual-step">
          <h3>Start with what is left over</h3>
          {leftovers.length === 0 ? (
            <p className="lede">Clean slate. Nothing was carried over from earlier days.</p>
          ) : (
            <>
              <p className="lede">These did not get done. Decide on each one before adding anything new.</p>
              <ul className="ritual-list">
                {leftovers.map((t) => (
                  <Row key={t.id} task={t}>
                    {t.date !== today && (
                      <button type="button" className="btn btn-quiet" onClick={() => sendTo(t.id, today)}>
                        Today
                      </button>
                    )}
                    <button type="button" className="btn btn-quiet" onClick={() => sendTo(t.id, tomorrow)}>
                      Tomorrow
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

      {step === 1 && (
        <div className="ritual-step">
          <h3>What do you want to get done today?</h3>
          <div className="ritual-cols">
            <div>
              <h4>Today ({open.length})</h4>
              <AddLine placeholder="Add a task, e.g. Review deck 30m #work" label="Add a task to today" onAdd={(t) => addFromText(t, today)} />
              <ul className="ritual-list">
                {open.map((t) => (
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
                    <button type="button" className="btn btn-quiet" onClick={() => sendTo(t.id, today)} aria-label={`Add ${t.title} to today`}>
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

      {step === 2 && (
        <div className="ritual-step">
          <h3>Does it fit in one day?</h3>
          <div className="fit">
            <div className="fit-num">
              <strong className={over > 0 ? 'is-over' : ''}>{fmtMin(planned)}</strong>
              <span>planned of {fmtMin(settings.capacityMin)}</span>
            </div>
            <LoadBar planned={planned} capacity={settings.capacityMin} />
            <p className={`fit-verdict ${over > 0 ? 'is-over' : ''}`}>
              {open.length === 0
                ? 'Nothing is planned yet. Go back and pick at least one thing.'
                : over > 0
                  ? `That is ${fmtMin(over)} more than fits. Move something out before you start.`
                  : `It fits, with ${fmtMin(-over)} to spare.`}
              {missing > 0 && ` ${missing} task${missing === 1 ? ' has' : 's have'} no estimate yet.`}
            </p>
            {likely !== null && Math.abs(likely - planned) >= 10 && (
              <p className="fit-forecast">
                Going by your tracked time, this is closer to <strong>{fmtMin(likely)}</strong> of real work.
              </p>
            )}
          </div>
          <ul className="ritual-list">
            {open.map((t) => (
              <Row key={t.id} task={t}>
                <button type="button" className="btn btn-quiet" onClick={() => sendTo(t.id, tomorrow)}>
                  Tomorrow
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => sendTo(t.id, null)}>
                  Backlog
                </button>
              </Row>
            ))}
          </ul>
        </div>
      )}

      {step === 3 && (
        <div className="ritual-step">
          <h3>Commit to the day</h3>
          <label className="stack">
            <span>If only one thing goes well today, what should it be?</span>
            <input className="field" value={intention} onChange={(e) => setIntention(e.target.value)} placeholder="One sentence" autoFocus />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} />
            Put the tasks on my timeline, starting now
          </label>
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
          </div>
        </div>
      )}

    </Dialog>
  );
}
