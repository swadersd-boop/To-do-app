import { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
  BarChart3,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Moon,
  PanelLeft,
  Play,
  Settings as SettingsIcon,
  Sunrise,
} from 'lucide-react';
import type { ISODate, Task } from './types';
import { useStore } from './store';
import { useUI } from './ui';
import { addDays, fromISO, todayISO } from './lib/dates';
import { tasksOn } from './lib/model';
import { isShareHash } from './lib/share';
import { snap } from './lib/time';
import { Board } from './components/Board';
import { Sidebar } from './components/Sidebar';
import { PX_PER_MIN, Timeline } from './components/Timeline';
import { TaskCardView } from './components/TaskCard';
import { TaskDetail } from './components/TaskDetail';
import { PlanRitual } from './components/PlanRitual';
import { ShutdownRitual } from './components/ShutdownRitual';
import { FocusMode } from './components/FocusMode';
import { Help, Insights, Settings } from './components/Panels';
import { SharedPlanView } from './components/SharedPlanView';

function useHash(): string {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

function useTheme() {
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141a17' : '#f5f1e8');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

/** Keeps "today" correct across midnight and carries unfinished tasks over. */
function useDayRollover() {
  const today = useUI((s) => s.today);
  const auto = useStore((s) => s.settings.autoRollover);
  useEffect(() => {
    const tick = () => {
      const now = todayISO();
      if (now !== useUI.getState().today) useUI.getState().setToday(now);
    };
    const id = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  useEffect(() => {
    if (auto) useStore.getState().rollover(today);
  }, [today, auto]);
}

/** Prefer the timeline, then the card under the pointer, then the list. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length === 0) return rectIntersection(args);
  const typeOf = (hit: (typeof hits)[number]) => hit.data?.droppableContainer?.data?.current?.type as string | undefined;
  const pick = hits.find((h) => typeOf(h) === 'timeline') ?? hits.find((h) => typeOf(h) === 'task') ?? hits[0];
  return [pick];
};

function Toast() {
  const toast = useUI((s) => s.toast);
  const dismiss = useUI((s) => s.dismissToast);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(dismiss, toast.action ? 7000 : 3500);
    return () => window.clearTimeout(id);
  }, [toast, dismiss]);
  if (!toast) return null;
  return (
    <div className="toast" role="status">
      {toast.message}
      {toast.action && (
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            toast.action!.run();
            dismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

function Header({ onFocus }: { onFocus: () => void }) {
  const ui = useUI();
  const log = useStore((s) => s.days[ui.today]);
  const month = fromISO(ui.boardStart).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const planned = Boolean(log?.plannedAt);
  const closed = Boolean(log?.shutdownAt);

  return (
    <header className="top">
      <button type="button" className={`icon-btn ${ui.sidebarOpen ? 'is-on' : ''}`} onClick={ui.toggleSidebar} aria-label="Backlog and objectives" aria-pressed={ui.sidebarOpen}>
        <PanelLeft size={18} />
      </button>
      <a className="brand" href="./" aria-label="Kalm">
        <svg viewBox="0 0 64 64" width="24" height="24" aria-hidden="true">
          <rect width="64" height="64" rx="15" fill="var(--accent)" />
          <path d="M12 41a20 20 0 0 1 40 0" fill="none" stroke="var(--accent-ink)" strokeWidth="5" strokeLinecap="round" />
          <path d="M10 49h44" stroke="var(--sun)" strokeWidth="5" strokeLinecap="round" />
        </svg>
        <span>Kalm</span>
      </a>

      <nav className="top-nav" aria-label="Days">
        <button type="button" className="icon-btn" onClick={() => ui.setBoardStart(addDays(ui.boardStart, -1))} aria-label="Earlier">
          <ChevronLeft size={18} />
        </button>
        <button type="button" className="btn btn-quiet" onClick={ui.goToday} disabled={ui.boardStart === ui.today && ui.selectedDay === ui.today}>
          Today
        </button>
        <button type="button" className="icon-btn" onClick={() => ui.setBoardStart(addDays(ui.boardStart, 1))} aria-label="Later">
          <ChevronRight size={18} />
        </button>
        <span className="top-month">{month}</span>
      </nav>

      <span className="spacer" />

      <div className="top-rituals">
        <button type="button" className={`btn ${planned ? 'is-complete' : 'btn-primary'}`} onClick={() => ui.openModal('plan')} aria-label={planned ? 'Planned' : 'Plan today'}>
          <Sunrise size={15} />
          <span className="label">{planned ? 'Planned' : 'Plan today'}</span>
          {planned && <Check size={13} className="tick" />}
        </button>
        <button
          type="button"
          className={`btn ${closed ? 'is-complete' : planned ? 'btn-primary' : ''}`}
          onClick={() => ui.openModal('shutdown')}
          aria-label={closed ? 'Closed' : 'Shut down'}
        >
          <Moon size={15} />
          <span className="label">{closed ? 'Closed' : 'Shut down'}</span>
          {closed && <Check size={13} className="tick" />}
        </button>
        <button type="button" className="btn" onClick={onFocus} aria-label="Focus">
          <Play size={14} fill="currentColor" />
          <span className="label">Focus</span>
        </button>
      </div>

      <button type="button" className="icon-btn" onClick={() => ui.openModal('insights')} aria-label="Insights">
        <BarChart3 size={18} />
      </button>
      <button type="button" className="icon-btn" onClick={() => ui.openModal('help')} aria-label="Shortcuts and help">
        <HelpCircle size={18} />
      </button>
      <button type="button" className="icon-btn" onClick={() => ui.openModal('settings')} aria-label="Settings">
        <SettingsIcon size={18} />
      </button>
      <button type="button" className={`icon-btn ${ui.timelineOpen ? 'is-on' : ''}`} onClick={ui.toggleTimeline} aria-label="Timeline" aria-pressed={ui.timelineOpen}>
        <CalendarClock size={18} />
      </button>
    </header>
  );
}

function Planner() {
  const ui = useUI();
  const intention = useStore((s) => s.days[ui.today]?.intention);
  const [active, setActive] = useState<Task | null>(null);
  const before = useRef<Task[] | null>(null);
  const todayAdd = useRef<HTMLInputElement>(null);

  useTheme();
  useDayRollover();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const startFocus = () => {
    const { tasks, timer, startTimer } = useStore.getState();
    const first = (timer && tasks.find((t) => t.id === timer.taskId)) || tasksOn(tasks, ui.today).find((t) => !t.done);
    if (!first) {
      ui.notify('Nothing planned for today yet.');
      return;
    }
    startTimer(first.id);
    ui.focusOn(first.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      const state = useUI.getState();
      if (typing || e.metaKey || e.ctrlKey || e.altKey || state.modal || state.openTaskId) return;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      switch (e.key) {
        case 'n':
          return run(() => {
            state.goToday();
            requestAnimationFrame(() => todayAdd.current?.focus());
          });
        case 'p':
          return run(() => state.openModal('plan'));
        case 's':
          return run(() => state.openModal('shutdown'));
        case 'f':
          return run(startFocus);
        case 't':
          return run(state.goToday);
        case 'b':
          return run(state.toggleSidebar);
        case 'l':
          return run(state.toggleTimeline);
        case '?':
          return run(() => state.openModal('help'));
        case 'ArrowLeft':
          return run(() => state.setBoardStart(addDays(state.boardStart, -1)));
        case 'ArrowRight':
          return run(() => state.setBoardStart(addDays(state.boardStart, 1)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // startFocus reads live state, so the handler never goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDragStart = (e: DragStartEvent) => {
    const tasks = useStore.getState().tasks;
    before.current = tasks;
    setActive(tasks.find((t) => t.id === e.active.id) ?? null);
  };

  const restore = () => {
    if (before.current) useStore.setState({ tasks: before.current });
  };

  // While the card is over another list, move it there so the list makes room.
  const onDragOver = (e: DragOverEvent) => {
    const { active: dragged, over } = e;
    const kind = over?.data.current?.type as string | undefined;
    if (!over || kind === 'timeline' || kind === undefined) return;
    const store = useStore.getState();
    const task = store.tasks.find((t) => t.id === dragged.id);
    if (!task) return;
    const overTask = kind === 'task' ? store.tasks.find((t) => t.id === over.id) : undefined;
    const dest: ISODate | null = overTask ? overTask.date : (over.data.current!.date as ISODate | null);
    if (dest === task.date) return;
    const list = tasksOn(store.tasks, dest);
    let index = list.length;
    if (overTask) {
      const top = dragged.rect.current.translated?.top ?? 0;
      index = list.findIndex((t) => t.id === overTask.id) + (top > over.rect.top + over.rect.height / 2 ? 1 : 0);
    }
    store.moveTask(task.id, dest, index);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active: dragged, over } = e;
    const original = before.current?.find((t) => t.id === dragged.id);
    setActive(null);
    const kind = over?.data.current?.type as string | undefined;
    if (!over || !original) return restore();
    const store = useStore.getState();
    const id = String(dragged.id);

    if (kind === 'timeline') {
      const grid = document.querySelector<HTMLElement>('[data-timeline-grid]');
      const top = dragged.rect.current.translated?.top;
      restore();
      if (!grid || top === undefined) return;
      const { dayStart, dayEnd } = store.settings;
      const raw = dayStart * 60 + (top - grid.getBoundingClientRect().top) / PX_PER_MIN;
      const start = Math.min(dayEnd * 60 - 15, Math.max(dayStart * 60, snap(raw, 15)));
      const day = useUI.getState().selectedDay;
      if (original.date !== day) useStore.getState().sendTo(id, day);
      useStore.getState().updateTask(id, { start });
      return;
    }

    const task = store.tasks.find((t) => t.id === id);
    if (!task) return;
    const list = tasksOn(store.tasks, task.date);
    const from = list.findIndex((t) => t.id === id);
    const to = kind === 'task' ? list.findIndex((t) => t.id === over.id) : from;
    if (to >= 0 && to !== from) store.moveTask(id, task.date, to);
    // A card that ends up back on its own day keeps its timebox.
    if (task.date === original.date && original.start !== null) useStore.getState().updateTask(id, { start: original.start });
    before.current = null;
  };

  return (
    <div className="app">
      <Header onFocus={startFocus} />
      {intention && (
        <p className="intention">
          <span>Today</span>
          {intention}
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActive(null);
          restore();
        }}
      >
        <main className={`shell ${ui.sidebarOpen ? 'has-sidebar' : ''} ${ui.timelineOpen ? 'has-timeline' : ''}`}>
          {ui.sidebarOpen && <Sidebar />}
          <Board todayAddRef={todayAdd} />
          {ui.timelineOpen && <Timeline />}
        </main>
        <DragOverlay dropAnimation={null}>{active && <TaskCardView task={active} dragging />}</DragOverlay>
      </DndContext>

      <TaskDetail />
      {ui.modal === 'plan' && <PlanRitual />}
      {ui.modal === 'shutdown' && <ShutdownRitual />}
      {ui.modal === 'focus' && <FocusMode />}
      {ui.modal === 'settings' && <Settings />}
      {ui.modal === 'insights' && <Insights />}
      {ui.modal === 'help' && <Help />}
      <Toast />
    </div>
  );
}

export default function App() {
  const hash = useHash();
  return isShareHash(hash) ? <SharedPlanView hash={hash} /> : <Planner />;
}
