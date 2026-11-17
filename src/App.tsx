import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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
  type Announcements,
  type DragMoveEvent,
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
  Square,
  Sunrise,
} from 'lucide-react';
import type { ISODate, Task } from './types';
import { useStore } from './store';
import { useUI } from './ui';
import { addDays, fromISO, relativeDay, todayISO } from './lib/dates';
import { focusTarget, tasksOn } from './lib/model';
import { isShareHash } from './lib/share';
import { fmtStopwatch, snap } from './lib/time';
import { TimerQuestion, timerAsk, useNow, useTracked } from './components/bits';
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
      const clock = new Date();
      const now = todayISO(clock);
      if (now !== useUI.getState().today) useUI.getState().setToday(now);
      // Meetings that are over count as done, without anyone ticking them off.
      useStore.getState().settleCommitments(now, clock.getHours() * 60 + clock.getMinutes());
    };
    tick();
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

/** Where the pointer is during a drag, or undefined for a keyboard drag. */
function pointerOf(e: DragMoveEvent | DragEndEvent): { x: number; y: number } | undefined {
  const ev = e.activatorEvent as (MouseEvent & TouchEvent) | null;
  const point = ev && 'touches' in ev && ev.touches.length > 0 ? ev.touches[0] : ev && 'clientY' in ev ? ev : null;
  if (!point) return undefined;
  return { x: point.clientX + e.delta.x, y: point.clientY + e.delta.y };
}

/** The time on the timeline at a screen height, snapped to 15 minutes. */
function minuteAt(y: number): number | null {
  const grid = document.querySelector<HTMLElement>('[data-timeline-grid]');
  if (!grid) return null;
  const from = Number(grid.dataset.dayStart);
  const to = Number(grid.dataset.dayEnd);
  const raw = from + (y - grid.getBoundingClientRect().top) / PX_PER_MIN;
  return Math.min(to - 15, Math.max(from, snap(raw, 15)));
}

const titleOf = (id: unknown) => useStore.getState().tasks.find((t) => t.id === id)?.title ?? 'Task';

/** Where a droppable is, in words: "Tomorrow", "the backlog", "the timeline", or next to another task. */
function placeOf(over: { id: unknown; data: { current?: Record<string, unknown> } } | null): string {
  if (!over) return 'nowhere';
  const data = over.data.current ?? {};
  if (data.type === 'timeline') return 'the timeline';
  const today = useUI.getState().today;
  const date = (data.type === 'task' ? useStore.getState().tasks.find((t) => t.id === over.id)?.date : data.date) as ISODate | null | undefined;
  const day = date === null || date === undefined ? 'the backlog' : relativeDay(date, today);
  return data.type === 'task' ? `${day}, next to ${titleOf(over.id)}` : day;
}

const announcements: Announcements = {
  onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
  onDragOver: ({ active, over }) => `${titleOf(active.id)} is over ${placeOf(over)}.`,
  onDragEnd: ({ active, over }) => (over ? `Dropped ${titleOf(active.id)} on ${placeOf(over)}.` : `${titleOf(active.id)} was put back.`),
  onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled. It is back where it was.`,
};

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
  const actions = toast?.actions ?? [];
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(dismiss, actions.length > 0 ? 9000 : 3500);
    return () => window.clearTimeout(id);
  }, [toast, dismiss, actions.length]);
  if (!toast) return null;
  return (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      {actions.length > 0 && (
        <span className="toast-actions">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className="link-btn"
              onClick={() => {
                a.run();
                dismiss();
              }}
            >
              {a.label}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * Shows a running timer wherever you are in the app, so time is never logged
 * by accident. When a timer runs far past the task's estimate it asks whether
 * you are still working, and can drop the time since then.
 */
function RunningBar() {
  const timer = useStore((s) => s.timer);
  const task = useStore((s) => s.tasks.find((t) => t.id === s.timer?.taskId));
  const modal = useUI((s) => s.modal);
  const { seconds } = useTracked(task?.id ?? '', task?.actualSec ?? 0);
  const now = useNow(20_000, Boolean(timer));

  useEffect(() => {
    if (!timer || !task) return;
    document.title = `${fmtStopwatch(seconds)} · ${task.title}`;
    return () => {
      document.title = 'Kalm';
    };
  }, [seconds, task, timer]);

  if (!timer || !task || modal === 'focus') return null;
  if (now >= timerAsk(timer, task, useStore.getState().tasks).at) {
    return (
      <div className="running is-asking">
        <span className="running-dot" aria-hidden="true" />
        <TimerQuestion />
      </div>
    );
  }
  return (
    <div className="running" role="status">
      <span className="running-dot" aria-hidden="true" />
      <span className="running-text">
        <span className="running-clock">{fmtStopwatch(seconds)}</span>
        <strong>{task.title}</strong>
      </span>
      <button type="button" className="btn btn-quiet" onClick={() => useUI.getState().focusOn(task.id)}>
        Open
      </button>
      <button type="button" className="btn" onClick={() => useStore.getState().stopTimer()} aria-label={`Stop the timer on ${task.title}`}>
        <Square size={12} fill="currentColor" />
        Stop
      </button>
    </div>
  );
}

function Header({ onFocus }: { onFocus: () => void }) {
  const ui = useUI();
  const log = useStore((s) => s.days[ui.today]);
  const month = fromISO(ui.boardStart).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const planned = Boolean(log?.plannedAt);
  const closed = Boolean(log?.shutdownAt);
  // One button stands out at a time: plan in the morning, focus while you work, shut down near the end.
  const dayEnd = useStore((s) => s.settings.dayEnd);
  const openWork = useStore((s) => s.tasks.some((t) => t.date === ui.today && !t.done && !t.fixed));
  const clock = useNow(60_000);
  const nowMin = new Date(clock).getHours() * 60 + new Date(clock).getMinutes();
  const windDown = planned && !closed && (nowMin >= dayEnd * 60 - 90 || !openWork);
  const working = planned && !closed && !windDown;

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
        <button type="button" className="btn btn-quiet" onClick={ui.goToday}>
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
          className={`btn ${closed ? 'is-complete' : windDown ? 'btn-primary' : ''}`}
          onClick={() => ui.openModal('shutdown')}
          aria-label={closed ? 'Closed' : 'Shut down'}
        >
          <Moon size={15} />
          <span className="label">{closed ? 'Closed' : 'Shut down'}</span>
          {closed && <Check size={13} className="tick" />}
        </button>
        <button type="button" className={`btn ${working ? 'btn-primary' : ''}`} onClick={onFocus} aria-label="Focus">
          <Play size={14} fill="currentColor" />
          <span className="label">Focus</span>
        </button>
      </div>

      <button type="button" className="icon-btn" onClick={() => ui.openModal('insights')} aria-label="Insights">
        <BarChart3 size={18} />
      </button>
      <button type="button" className="icon-btn hide-narrow" onClick={() => ui.openModal('help')} aria-label="Shortcuts and help">
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
  const overTimeline = useRef(false);
  /** The pointer is near the board's right edge with the timeline open, so it is heading there. */
  const towardTimeline = useRef(false);
  const boardScroll = useRef(0);
  const hasExamples = useStore((s) => s.tasks.some((t) => t.example));
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
    const now = new Date();
    const first = (timer && tasks.find((t) => t.id === timer.taskId)) || focusTarget(tasksOn(tasks, ui.today), now.getHours() * 60 + now.getMinutes());
    if (!first) {
      ui.notify('Nothing left to work on today.');
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
            // Render today's column right away, so the very next keystroke lands in the box.
            flushSync(() => state.goToday());
            todayAdd.current?.focus();
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
          // On a card or block the arrows belong to it, so the board stays where it is.
          if (target.closest('.card-wrap, .block')) return;
          return run(() => state.setBoardStart(addDays(state.boardStart, -1)));
        case 'ArrowRight':
          if (target.closest('.card-wrap, .block')) return;
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
    overTimeline.current = false;
    boardScroll.current = document.querySelector('.board')?.scrollLeft ?? 0;
    setActive(tasks.find((t) => t.id === e.active.id) ?? null);
  };

  const restore = () => {
    if (before.current) useStore.setState({ tasks: before.current });
  };

  // While the card is over another list, move it there so the list makes room.
  const onDragOver = (e: DragOverEvent) => {
    const { active: dragged, over } = e;
    const kind = over?.data.current?.type as string | undefined;
    overTimeline.current = kind === 'timeline';
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

  const onDragMove = (e: DragMoveEvent) => {
    const point = pointerOf(e);
    const board = document.querySelector('.board')?.getBoundingClientRect();
    towardTimeline.current = Boolean(point && board && useUI.getState().timelineOpen && point.x > board.right - 140);
    const over = e.over?.data.current?.type === 'timeline';
    useUI.getState().setDropAt(over ? minuteAt(point?.y ?? e.active.rect.current.translated?.top ?? 0) : null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active: dragged, over } = e;
    const original = before.current?.find((t) => t.id === dragged.id);
    setActive(null);
    useUI.getState().setDropAt(null);
    const kind = over?.data.current?.type as string | undefined;
    if (!over || !original) return restore();
    const store = useStore.getState();
    const id = String(dragged.id);

    if (kind === 'timeline') {
      // The task lands where the pointer is. A keyboard drag uses the top of the card.
      const y = pointerOf(e)?.y ?? dragged.rect.current.translated?.top;
      restore();
      useUI.getState().setDropAt(null);
      // Passing the board's edge on the way here may have nudged it sideways. Put it back.
      document.querySelector('.board')?.scrollTo({ left: boardScroll.current });
      const start = y === undefined ? null : minuteAt(y);
      if (start === null) return;
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
    // Keep the moved card in sight, which matters most when moving it with the keyboard.
    requestAnimationFrame(() => document.querySelector(`[data-task-id="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
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
      {hasExamples && (
        <p className="notice">
          These are example tasks that show how Kalm works.
          <button type="button" className="link-btn" onClick={() => useStore.getState().removeExamples()}>
            Remove the examples
          </button>
        </p>
      )}
      <RunningBar />
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        accessibility={{ announcements, screenReaderInstructions: { draggable: 'To move a task, press Space, use the arrow keys, then press Space again to drop it, or Escape to cancel.' } }}
        autoScroll={{
          threshold: { x: 0.06, y: 0.2 },
          // The board must not run away while a card is held over the timeline.
          canScroll: (el) => !((overTimeline.current || towardTimeline.current) && el.classList.contains('board')),
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActive(null);
          useUI.getState().setDropAt(null);
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
