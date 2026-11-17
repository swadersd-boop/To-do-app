import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ISODate } from './types';
import { todayISO } from './lib/dates';

export type Modal = 'plan' | 'shutdown' | 'focus' | 'settings' | 'insights' | 'help' | null;

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  actions?: ToastAction[];
}

interface UI {
  today: ISODate;
  /** The day shown on the timeline. */
  selectedDay: ISODate;
  /** The first day column on the board. */
  boardStart: ISODate;
  openTaskId: string | null;
  focusTaskId: string | null;
  /** When the task in focus was opened, for counting time on a task finished without starting the timer. */
  focusOpenedAt: number | null;
  modal: Modal;
  sidebarOpen: boolean;
  timelineOpen: boolean;
  toast: Toast | null;
  /** Bumped to ask the board to scroll back to its first column. */
  boardReset: number;
  /** While a card is dragged over the timeline: the time it would get. */
  dropAt: number | null;
  setDropAt: (min: number | null) => void;

  setToday: (d: ISODate) => void;
  selectDay: (d: ISODate) => void;
  setBoardStart: (d: ISODate) => void;
  goToday: () => void;
  openTask: (id: string | null) => void;
  openModal: (m: Modal) => void;
  focusOn: (id: string) => void;
  toggleSidebar: () => void;
  toggleTimeline: () => void;
  notify: (message: string, ...actions: ToastAction[]) => void;
  dismissToast: () => void;
}

const atLeast = (px: number) => typeof window === 'undefined' || window.innerWidth >= px;

/** View state. Only the two panel toggles are remembered between visits. */
export const useUI = create<UI>()(
  persist(
    (set) => ({
      today: todayISO(),
      selectedDay: todayISO(),
      boardStart: todayISO(),
      openTaskId: null,
      focusTaskId: null,
      focusOpenedAt: null,
      modal: null,
      sidebarOpen: atLeast(1200),
      timelineOpen: atLeast(900),
      toast: null,
      boardReset: 0,
      dropAt: null,
      setDropAt: (min) => set((s) => (s.dropAt === min ? s : { dropAt: min })),

      setToday: (d) =>
        set((s) => ({
          today: d,
          selectedDay: s.selectedDay === s.today ? d : s.selectedDay,
          boardStart: s.boardStart === s.today ? d : s.boardStart,
        })),
      selectDay: (d) => set({ selectedDay: d }),
      setBoardStart: (d) => set({ boardStart: d }),
      goToday: () => set((s) => ({ boardStart: s.today, selectedDay: s.today, boardReset: s.boardReset + 1 })),
      openTask: (id) => set({ openTaskId: id }),
      openModal: (m) => set({ modal: m }),
      focusOn: (id) => set({ focusTaskId: id, focusOpenedAt: Date.now(), modal: 'focus', openTaskId: null }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleTimeline: () => set((s) => ({ timelineOpen: !s.timelineOpen })),
      notify: (message, ...actions) => set({ toast: { id: Date.now(), message, actions } }),
      dismissToast: () => set({ toast: null }),
    }),
    {
      name: 'kalm:ui',
      partialize: (s) => ({ sidebarOpen: s.sidebarOpen, timelineOpen: s.timelineOpen }),
    },
  ),
);
