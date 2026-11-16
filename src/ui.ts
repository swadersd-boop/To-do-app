import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ISODate } from './types';
import { todayISO } from './lib/dates';

export type Modal = 'plan' | 'shutdown' | 'focus' | 'settings' | 'insights' | 'help' | null;

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

interface UI {
  today: ISODate;
  /** The day shown on the timeline. */
  selectedDay: ISODate;
  /** The first day column on the board. */
  boardStart: ISODate;
  openTaskId: string | null;
  focusTaskId: string | null;
  modal: Modal;
  sidebarOpen: boolean;
  timelineOpen: boolean;
  toast: Toast | null;

  setToday: (d: ISODate) => void;
  selectDay: (d: ISODate) => void;
  setBoardStart: (d: ISODate) => void;
  goToday: () => void;
  openTask: (id: string | null) => void;
  openModal: (m: Modal) => void;
  focusOn: (id: string) => void;
  toggleSidebar: () => void;
  toggleTimeline: () => void;
  notify: (message: string, action?: Toast['action']) => void;
  dismissToast: () => void;
}

const wide = () => typeof window === 'undefined' || window.innerWidth >= 900;

/** View state. Only the two panel toggles are remembered between visits. */
export const useUI = create<UI>()(
  persist(
    (set) => ({
      today: todayISO(),
      selectedDay: todayISO(),
      boardStart: todayISO(),
      openTaskId: null,
      focusTaskId: null,
      modal: null,
      sidebarOpen: wide(),
      timelineOpen: wide(),
      toast: null,

      setToday: (d) =>
        set((s) => ({
          today: d,
          selectedDay: s.selectedDay === s.today ? d : s.selectedDay,
          boardStart: s.boardStart === s.today ? d : s.boardStart,
        })),
      selectDay: (d) => set({ selectedDay: d }),
      setBoardStart: (d) => set({ boardStart: d }),
      goToday: () => set((s) => ({ boardStart: s.today, selectedDay: s.today })),
      openTask: (id) => set({ openTaskId: id }),
      openModal: (m) => set({ modal: m }),
      focusOn: (id) => set({ focusTaskId: id, modal: 'focus', openTaskId: null }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleTimeline: () => set((s) => ({ timelineOpen: !s.timelineOpen })),
      notify: (message, action) => set({ toast: { id: Date.now(), message, action } }),
      dismissToast: () => set({ toast: null }),
    }),
    {
      name: 'kalm:ui',
      partialize: (s) => ({ sidebarOpen: s.sidebarOpen, timelineOpen: s.timelineOpen }),
    },
  ),
);
