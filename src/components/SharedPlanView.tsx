import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { decodePlan, type SharedPlan } from '../lib/share';
import { longDate } from '../lib/dates';
import { fmtClock, fmtMin } from '../lib/time';

/** The read-only page a friend sees when they open a shared plan link. */
export function SharedPlanView({ hash }: { hash: string }) {
  const [plan, setPlan] = useState<SharedPlan | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void decodePlan(hash).then((p) => live && setPlan(p));
    return () => {
      live = false;
    };
  }, [hash]);

  const home = `${location.pathname}${location.search}`;
  if (plan === undefined) return <main className="shared" aria-busy="true" />;

  if (plan === null) {
    return (
      <main className="shared">
        <div className="shared-card">
          <h1>This link is broken</h1>
          <p className="muted">The plan in it could not be read. Ask for a fresh link.</p>
          <a className="btn btn-primary" href={home}>
            Open Kalm
          </a>
        </div>
      </main>
    );
  }

  const total = plan.tasks.reduce((sum, t) => sum + (t.planned ?? 0), 0);
  return (
    <main className="shared">
      <div className="shared-card">
        <p className="shared-kicker">{plan.name.trim() ? `${plan.name.trim()}'s plan` : 'A plan'}</p>
        <h1>{longDate(plan.date)}</h1>
        {plan.intention && <p className="shared-intention">{plan.intention}</p>}
        <ol className="shared-list">
          {plan.tasks.map((t, i) => (
            <li key={i} className={t.done ? 'is-done' : ''}>
              <span className="shared-title">{t.title}</span>
              <span className="shared-meta">
                {t.channel && (
                  <span className="pill">
                    <span className="dot" style={{ background: t.color ?? 'var(--accent)' }} />
                    {t.channel}
                  </span>
                )}
                {typeof t.start === 'number' && (
                  <span className="meta">
                    <Clock size={12} />
                    {fmtClock(t.start)}
                  </span>
                )}
                {typeof t.planned === 'number' && <span className="chip">{fmtMin(t.planned)}</span>}
              </span>
            </li>
          ))}
        </ol>
        {plan.tasks.length === 0 && <p className="muted">Nothing planned.</p>}
        {total > 0 && <p className="shared-total">{fmtMin(total)} planned</p>}
        <a className="btn btn-primary" href={home}>
          Plan your own day with Kalm
        </a>
      </div>
    </main>
  );
}
