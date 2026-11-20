import { constants, setPriority } from 'node:os';
import type { QrJob, QrMade } from './qr-maker';
import { makeQr } from './qr-maker';
import { readQr } from './qr-read';

/*
 * The QR worker (Q60-28): an Electron utility process, started for one code and stopped once it has answered, that
 * makes a QR code's pictures and reads each back (qr-maker.ts), below normal priority, so neither Main's thread nor
 * the show's screens wait for a picture of 2048 pixels to be drawn, compressed and read. It prints nothing.
 */

const port = process.parentPort;

try {
  setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
} catch {
  // Not allowed on this system: run at normal priority.
}

port.on('message', (event: { data: unknown }) => {
  let made: QrMade;
  try {
    made = makeQr(event.data as QrJob, readQr);
  } catch {
    made = { ok: false, message: 'The QR code could not be made: try again.' };
  }
  port.postMessage(made);
});
