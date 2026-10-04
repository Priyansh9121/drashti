import { create } from 'zustand';
import type { CalendarView } from '../../../shared/calendar';

/*
 * The loaded calendars and today's entry, in the operator window (kept
 * current from the main process), and whether the Calendar dialog is open.
 * The screens read today's entry from the engine's state instead.
 */

interface CalendarStore {
  view: CalendarView | null;
  open: boolean;
}

export const useCalendar = create<CalendarStore>(() => ({ view: null, open: false }));

let started = false;

export function connectCalendar(): void {
  if (started) return;
  started = true;
  window.drashti.calendar.onChanged((view) => {
    useCalendar.setState({ view });
  });
  void window.drashti.calendar.view().then((view) => {
    useCalendar.setState({ view });
  });
}

export function openCalendar(open = true): void {
  connectCalendar();
  useCalendar.setState({ open });
}
