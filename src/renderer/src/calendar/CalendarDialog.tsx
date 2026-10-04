import { useEffect, useState } from 'react';
import type { CalendarDay, CalendarInfo } from '../../../shared/calendar';
import { CALENDAR_LANGS, festivalsLine, samvatLine } from '../../../shared/calendar';
import { importWithDialog } from '../library/import-store';
import { useEngine } from '../engine/engine-store';
import { Button } from '../ui/Button';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { CalendarDays, Trash2, Upload } from '../ui/icons';
import { SectionTitle } from '../ui/Panel';
import { EmptyState } from '../ui/States';
import { connectCalendar, openCalendar, useCalendar } from './calendar-store';

/*
 * The Calendar dialog (Pro Mode; Timers › Calendar): today's Samvat date and
 * tithi in both languages, the loaded calendars with their dates, Load a
 * calendar…, and Remove. Drashti computes no tithi: it shows what the
 * calendars give, and nothing for a date they do not.
 */

/** Today's entry in Gujarati and English, with festivals. */
export function TodayLines({ day }: { day: CalendarDay }) {
  return (
    <div className="space-y-1" data-testid="calendar-today">
      {CALENDAR_LANGS.map((lang) => {
        const festivals = festivalsLine(day, lang);
        return (
          <p key={lang} lang={lang} className="text-sm">
            {samvatLine(day, lang)}
            {festivals && <strong className="text-warning-fg">{` · ${festivals}`}</strong>}
          </p>
        );
      })}
    </div>
  );
}

function CalendarRow({ c, onRemove }: { c: CalendarInfo; onRemove: () => void }) {
  return (
    <tr data-testid="calendar-row" className="border-t border-line">
      <td className="py-1.5 pr-3 font-medium">{c.name}</td>
      <td className="py-1.5 pr-3 whitespace-nowrap text-muted tabular-nums">
        {c.firstDate} to {c.lastDate}
      </td>
      <td className="py-1.5 pr-3 text-right text-muted tabular-nums">{c.dayCount.toLocaleString('en')}</td>
      <td className="py-1.5 text-right">
        <Button variant="ghost" size="sm" icon={Trash2} onClick={onRemove} aria-label={`Remove ${c.name}`}>
          Remove
        </Button>
      </td>
    </tr>
  );
}

export function CalendarDialog() {
  const open = useCalendar((s) => s.open);
  const view = useCalendar((s) => s.view);
  // The screens' entry: the same as the dialog's, from the engine.
  const today = useEngine((s) => s.state?.calendar ?? null);
  const [removing, setRemoving] = useState<CalendarInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (open) connectCalendar();
  }, [open]);
  if (!open) return null;
  const close = () => {
    openCalendar(false);
    setProblem(null);
  };
  const calendars = view?.calendars ?? [];
  return (
    <Dialog
      title="Calendar"
      subtitle="Load only a calendar that BAPS or the mandir has authorised. Drashti computes no tithi: it shows what the calendar gives for each date."
      onClose={close}
      closeLabel="Close the calendar"
      size="lg"
      testId="calendar-dialog"
      headerActions={
        <Button icon={Upload} data-testid="load-calendar" onClick={() => void importWithDialog('files')}>
          Load a calendar…
        </Button>
      }
    >
      <div className="space-y-5">
        <section className="space-y-2" aria-labelledby="calendar-today-title">
          <SectionTitle>
            <span id="calendar-today-title">Today</span>
          </SectionTitle>
          {today ? (
            <TodayLines day={today} />
          ) : (
            <p className="text-sm text-muted" data-testid="calendar-no-today">
              No loaded calendar gives today&apos;s date, so nothing shows for it.
            </p>
          )}
          <p className="text-xs text-muted">
            It shows under the operator window&apos;s controls; on stage screens with a Samvat box (or a clock
            box with the date) in their layout; and on the audience screens in a message with a Samvat field.
          </p>
        </section>
        <section className="space-y-2" aria-labelledby="calendar-list-title">
          <SectionTitle>
            <span id="calendar-list-title">Loaded calendars</span>
          </SectionTitle>
          {calendars.length > 0 ? (
            <table className="w-full text-sm" data-testid="calendar-table">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-1 font-medium">Name</th>
                  <th className="pb-1 font-medium">Dates</th>
                  <th className="pb-1 text-right font-medium">Days</th>
                  <th className="pb-1">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {calendars.map((c) => (
                  <CalendarRow key={c.id} c={c} onRemove={() => setRemoving(c)} />
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState icon={CalendarDays} title="No calendars yet" compact>
              Load the mandir&apos;s calendar file (its format is in docs/calendar-format.md), or drag it onto
              the library.
            </EmptyState>
          )}
          {problem && (
            <p role="alert" className="text-sm text-danger-fg">
              {problem}
            </p>
          )}
        </section>
      </div>
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          confirmLabel="Remove"
          testId="calendar-remove-confirm"
          onConfirm={() => {
            void window.drashti.calendar.remove(removing.id).then((r) => {
              setRemoving(null);
              setProblem(r.ok ? null : r.message);
            });
          }}
          onCancel={() => setRemoving(null)}
        >
          Its dates show nothing until a calendar that gives them is loaded. Loading the file again brings it
          back.
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
