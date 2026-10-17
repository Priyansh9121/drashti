import { app } from 'electron';
import { type ClockStyle, ownClockStyle } from '../shared/format';
import { sw } from './switches';

/**
 * How this computer writes the time (Sessions 31–36, I18N-8): its locale and time zone, sent to every output,
 * node, the stream's page, the stage display and the remote, so their clocks all say Main's time.
 * DRASHTI_TEST_CLOCK_STYLE ("en-GB Pacific/Chatham"; tests only, ignored by a packaged Drashti) stands Main in
 * another place.
 */
export function mainClockStyle(): ClockStyle {
  const test = sw('DRASHTI_TEST_CLOCK_STYLE');
  if (test) {
    const [locale = 'en-GB', timeZone = 'UTC'] = test.trim().split(/\s+/u);
    return { locale, timeZone };
  }
  return ownClockStyle(app.getLocale());
}
