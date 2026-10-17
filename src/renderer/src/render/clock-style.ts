import { createContext } from 'react';
import type { ClockStyle } from '../../../shared/format';

/**
 * How Drashti's computer writes the time (Sessions 31–36, I18N-8), given by each page's root: an output's
 * context (from Main, or from Main through a node), the stream's page, the stage display, the remote. The
 * stage clock and clock timers write the time in it, so a node in another time zone shows Main's. Null:
 * this computer's own way.
 */
export const ClockStyleContext = createContext<ClockStyle | null>(null);
