import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { REPORT_PRIVATE_ATTR } from '../../../shared/report-private';
import { QrCode } from './QrCode';

/*
 * A QR code carries a pairing code, the Chat QR's code or the poster link's key (alpha.23): Report a Problem's picture
 * of the window blanks it (main/report/private-parts.ts), as it blanks the chat.
 */

describe('a QR code in the operator window', () => {
  it('is marked private, so Report a Problem’s picture never shows a working code', () => {
    const markup = renderToStaticMarkup(
      createElement(QrCode, { text: 'http://192.0.2.1:8740/pair#c=000000', label: 'QR' }),
    );
    expect(markup).toContain(`${REPORT_PRIVATE_ATTR}=""`);
  });
});
