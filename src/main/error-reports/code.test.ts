import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

it.each(['new tab', 'interrupted empty tab', 'interrupted tab setup'] as const)(
  'runs the pasted adapter with local services and preserves leading-zero numeric ids after %s',
  (setup) => {
    // A failed first request can leave the header but never reach the text formats.
    const rows: unknown[][] = setup === 'interrupted tab setup' ? [['Install id', 'Report id']] : [];
    const files = new Map<string, { text: string; id: string }>();
    const key = 'd'.repeat(64);
    const installId = '0'.repeat(31) + '2';
    let locked = false;
    let releases = 0;
    const textColumns = new Set<number>();
    const sheet = {
      appendRow: (row: unknown[]) => {
        expect(locked).toBe(true);
        rows.push(
          row.map((value, column) =>
            typeof value === 'string' && /^\d+$/u.test(value) && !textColumns.has(column)
              ? Number(value)
              : value,
          ),
        );
      },
      setFrozenRows: () => undefined,
      getLastRow: () => rows.length,
      getRange: (range: string | number) => ({
        getValues: () => rows.slice(1).map((r) => r.slice(0, 3)),
        setNumberFormat: (format: string) => {
          expect(locked).toBe(true);
          expect(format).toBe('@');
          const columns =
            range === 'A:B'
              ? [0, 1]
              : range === 'E:L'
                ? [4, 5, 6, 7, 8, 9, 10, 11]
                : range === 'S:V'
                  ? [18, 19, 20, 21]
                  : [];
          for (const column of columns) textColumns.add(column);
        },
      }),
    };
    const file = (id: string) => ({ getId: () => id });
    const context = {
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (name: string) =>
            ({
              SHEET_ID: 'fake-sheet',
              FOLDER_ID: 'fake-folder',
              ['INSTALL_' + installId]: key,
            })[name],
        }),
      },
      LockService: {
        getScriptLock: () => ({
          tryLock: () => {
            locked = true;
            return true;
          },
          releaseLock: () => {
            locked = false;
            releases++;
          },
        }),
      },
      SpreadsheetApp: {
        openById: (id: string) => {
          expect(id).toBe('fake-sheet');
          return {
            getSheetByName: () => (rows.length || setup === 'interrupted empty tab' ? sheet : null),
            insertSheet: () => sheet,
          };
        },
        flush: () => undefined,
      },
      DriveApp: {
        getFolderById: (id: string) => {
          expect(id).toBe('fake-folder');
          return {
            getFilesByName: (name: string) => ({
              hasNext: () => files.has(name),
              next: () => file(files.get(name)?.id ?? 'missing'),
            }),
            createFile: (name: string, text: string, mime: string) => {
              expect(locked).toBe(true);
              expect(mime).toBe('application/json');
              files.set(name, { text, id: 'fake-file' });
              return file('fake-file');
            },
          };
        },
      },
      Utilities: {
        Charset: { UTF_8: 'utf8' },
        computeHmacSha256Signature: (text: string, secret: string) =>
          [...createHmac('sha256', secret).update(text).digest()].map((n) => (n > 127 ? n - 256 : n)),
      },
      ContentService: {
        MimeType: { JSON: 'application/json' },
        createTextOutput: (text: string) => ({
          setMimeType: (mime: string) => {
            expect(mime).toBe('application/json');
            return text;
          },
        }),
      },
    };
    const vm = { ...context, doPost: undefined as undefined | ((e: unknown) => string) };
    for (const name of ['core.js', 'Code.js'])
      runInNewContext(
        readFileSync(join(__dirname, '../../..', 'access-list/error-reports', name), 'utf8'),
        vm,
      );
    const payload = JSON.stringify({
      id: '0'.repeat(31) + '1',
      at: 1000,
      trigger: 'crash',
      code: 'process-crashed',
      diagnosticsInstallId: '7K3P-Q2XM-4H9A',
      mode: 'pro',
      osRelease: '10.0.26100',
      computerId: '0'.repeat(63) + '3',
      accessEntryId: '0'.repeat(31) + '4',
      version: '1.0.0-alpha.22',
      platform: 'win32',
      arch: 'x64',
      role: 'main',
      counts: { minutes: 1, shows: 2, streams: 3, recordings: 4, imports: 5 },
      dropped: 0,
      events: [],
    });
    const mac = createHmac('sha256', key)
      .update('drashti-errors-v1\n' + installId + '\n' + payload)
      .digest('hex');
    const post = vm.doPost;
    if (!post) throw new Error('Apps Script adapter did not load');
    const event = { postData: { contents: JSON.stringify({ v: 1, installId, payload, mac }) } };
    expect(JSON.parse(post(event))).toEqual({ ok: true, id: '0'.repeat(31) + '1' });
    expect(JSON.parse(post(event))).toEqual({ ok: true, id: '0'.repeat(31) + '1' });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.slice(0, 2)).toEqual(['Install id', 'Report id']);
    expect(files.size).toBe(1);
    expect(releases).toBe(2);
    expect(rows[1]?.slice(4, 12)).toEqual([
      '0'.repeat(63) + '3',
      '0'.repeat(31) + '4',
      '1.0.0-alpha.22',
      'win32',
      'x64',
      'main',
      'crash',
      'process-crashed',
    ]);
  },
);
