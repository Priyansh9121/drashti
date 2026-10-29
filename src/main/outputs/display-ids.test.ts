import { describe, expect, it } from 'vitest';
import type { DisplayReading, TieDisplay, WinOutput } from './display-ids';
import {
  DisplayIds,
  hardwareKey,
  macReading,
  parseEdid,
  parseMacDisplays,
  parseWindowsOutputs,
  readMac,
  readWindows,
  systemReader,
  tieWindows,
  windowsReading,
} from './display-ids';

/*
 * Each display's own identity (Session 55): its EDID's maker, model and serial number, read on a Mac from
 * system_profiler and on Windows from the display configuration and the registry, tied to Electron's displays.
 * CI's computers have virtual displays only: these readings are stand-ins, written here (placeholder makers,
 * models and serial numbers); one test asks the real system, to see that its reading can be read at all.
 */

/** A maker's three letters as EDID packs them (Dell's DEL is 10ac). */
const maker = (letters: string) =>
  Array.from({ length: letters.length }, (_, i) => letters.charCodeAt(i) - 64).reduce(
    (code, c) => (code << 5) | c,
    0,
  );

/** An EDID's first 128 bytes, in hex, as a display would give them. */
function edid(o: {
  maker: string;
  product: number;
  serial: number;
  serialText?: string;
  name?: string;
}): string {
  const b = new Array<number>(128).fill(0);
  [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00].forEach((v, i) => (b[i] = v));
  const m = maker(o.maker);
  b[8] = (m >> 8) & 0xff;
  b[9] = m & 0xff;
  b[10] = o.product & 0xff;
  b[11] = (o.product >> 8) & 0xff;
  for (let i = 0; i < 4; i++) b[12 + i] = (o.serial >>> (8 * i)) & 0xff;
  const descriptor = (at: number, tag: number, text: string) => {
    b[at + 3] = tag;
    const chars = `${text}\n`.padEnd(13, ' ').slice(0, 13);
    for (let i = 0; i < 13; i++) b[at + 5 + i] = chars.charCodeAt(i);
  };
  if (o.name !== undefined) descriptor(54, 0xfc, o.name);
  if (o.serialText !== undefined) descriptor(72, 0xff, o.serialText);
  return b.map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** A display as Electron has it, as tying a reading needs. */
const shown = (
  id: number,
  label: string,
  x: number,
  pixelWidth = 1920,
  pixelHeight = 1080,
  primary = false,
  width = pixelWidth,
): TieDisplay => ({
  id,
  label,
  bounds: { x, y: 0, width, height: Math.round((pixelHeight * width) / pixelWidth) },
  pixelWidth,
  pixelHeight,
  primary,
});

describe('a display’s EDID', () => {
  it('says its maker, model, serial number and name', () => {
    const e = parseEdid(
      edid({ maker: 'DEL', product: 0xa0f3, serial: 0x4c4c4c4c, serialText: 'PH-0001', name: 'PLACEHOLDER' }),
    );
    expect(e).toEqual({
      vendor: '10ac',
      product: 'a0f3',
      serial: '4c4c4c4c',
      serialText: 'PH-0001',
      name: 'PLACEHOLDER',
    });
  });

  it('is none when it is not an EDID (too short, or without its header)', () => {
    expect(parseEdid('')).toBeNull();
    expect(parseEdid('00'.repeat(128))).toBeNull();
    expect(parseEdid(edid({ maker: 'DEL', product: 1, serial: 2 }).slice(0, 200))).toBeNull();
  });

  it('a key from its serial number, else its serial as text, else none', () => {
    const e = { vendor: '10AC', product: '0xA0F3', serial: '4c4c4c4c', serialText: 'PH-0001', name: '' };
    expect(hardwareKey(e)).toBe('edid:10ac:a0f3:n4c4c4c4c');
    // A serial number that tells no unit apart: the text.
    for (const serial of ['', '0', '00000001', '01010101', 'ffffffff'])
      expect(hardwareKey({ ...e, serial })).toBe('edid:10ac:a0f3:sPH-0001');
    // Neither: no key (found as before).
    for (const serialText of ['', '  ', '0000000', 'SERIAL', 'n/a', '12'])
      expect(hardwareKey({ ...e, serial: '0', serialText })).toBeNull();
    expect(hardwareKey({ ...e, vendor: '' })).toBeNull();
  });
});

/** system_profiler's list as a Mac gives it: its built-in display and two projectors of one model. */
const macList = (mirror = false) => ({
  SPDisplaysDataType: [
    {
      _name: 'Placeholder GPU',
      spdisplays_ndrvs: [
        {
          _name: 'Color LCD',
          '_spdisplays_display-product-id': 'a049',
          '_spdisplays_display-serial-number': 'fd626d62',
          '_spdisplays_display-vendor-id': '610',
          _spdisplays_displayID: '1',
          spdisplays_connection_type: 'spdisplays_internal',
          spdisplays_mirror: mirror ? 'spdisplays_on' : 'spdisplays_off',
        },
        {
          _name: 'PLACEHOLDER PJ',
          '_spdisplays_display-product-id': '1234',
          '_spdisplays_display-serial-number': '1111',
          '_spdisplays_display-vendor-id': '4c2d',
          _spdisplays_displayID: '3',
          spdisplays_mirror: mirror ? 'spdisplays_on' : 'spdisplays_off',
        },
        ...(mirror
          ? []
          : [
              {
                _name: 'PLACEHOLDER PJ',
                '_spdisplays_display-product-id': '1234',
                '_spdisplays_display-serial-number': '0',
                // Its serial number as text only (any field naming one).
                'spdisplays_display-serial-number': 'PJ-2222',
                '_spdisplays_display-vendor-id': '4c2d',
                _spdisplays_displayID: '4',
                spdisplays_mirror: 'spdisplays_off',
              },
            ]),
      ],
    },
  ],
});

describe('a Mac’s displays (system_profiler)', () => {
  it('each display’s identity by Electron’s id, two projectors of one model told apart', () => {
    const displays = [
      shown(1, 'Built-in Retina Display', 0, 2880, 1800, true, 1440),
      shown(3, 'PLACEHOLDER PJ', 1440),
      shown(4, 'PLACEHOLDER PJ', 3360),
    ];
    const reading = macReading(parseMacDisplays(macList()), displays);
    expect([...reading.ids]).toEqual([
      [1, 'edid:610:a049:nfd626d62'],
      [3, 'edid:4c2d:1234:n1111'],
      [4, 'edid:4c2d:1234:sPJ-2222'],
    ]);
    expect(reading.mirroredOnto).toEqual([]);
  });

  it('mirroring: said, by the name of the display it mirrors onto', () => {
    const reading = macReading(parseMacDisplays(macList(true)), [
      shown(1, 'Built-in Retina Display', 0, 2880, 1800, true, 1440),
    ]);
    expect(reading.mirroredOnto).toEqual(['PLACEHOLDER PJ']);
    expect([...reading.ids.keys()]).toEqual([1]);
  });

  it('an id that is not Electron’s ties by a name only it has; anything else is passed over', () => {
    const list = macList();
    const reading = macReading(parseMacDisplays(list), [shown(77, 'Color LCD', 0)]);
    expect([...reading.ids]).toEqual([[77, 'edid:610:a049:nfd626d62']]);
    expect(parseMacDisplays(null)).toEqual([]);
    expect(parseMacDisplays({ SPDisplaysDataType: [{ spdisplays_ndrvs: [null, 7] }] })).toEqual([]);
  });

  it('a reading that fails, or is not JSON, is none', async () => {
    expect(await readMac([], () => Promise.resolve(null))).toBeNull();
    expect(await readMac([], () => Promise.resolve('not json'))).toBeNull();
    const asked: string[] = [];
    await readMac([], (file, args) => {
      asked.push([file, ...args].join(' '));
      return Promise.resolve(JSON.stringify(macList()));
    });
    expect(asked).toEqual(['/usr/sbin/system_profiler SPDisplaysDataType -json']);
  });
});

/** Windows' outputs as the script prints them. */
const output = (
  gdi: string,
  x: number,
  width: number,
  height: number,
  targets: { name: string; serial: number; internal?: boolean }[],
  primary = false,
): WinOutput => ({
  gdi,
  primary,
  x,
  y: 0,
  width,
  height,
  targets: targets.map((t, i) => ({
    path: `\\\\?\\DISPLAY#PLC1234#5&placeholder&0&UID${String(i)}#{guid}`,
    name: t.name,
    internal: t.internal ?? false,
    edid: edid({ maker: 'PLC', product: 0x1234, serial: t.serial, name: t.name }),
  })),
});

describe('Windows’ displays (the display configuration and the registry)', () => {
  it('ties the primary, then same-sized displays by their order across the desktop, at any scale', () => {
    // A laptop at 150% (1920 × 1080 pixels, 1280 × 720 of Electron's), two projectors of one model to its right.
    const outputs = [
      output('\\\\.\\DISPLAY3', 3840, 1920, 1080, [{ name: 'PLACEHOLDER PJ', serial: 0x2222 }]),
      output('\\\\.\\DISPLAY1', 0, 1920, 1080, [{ name: 'Built in', serial: 0x5, internal: true }], true),
      output('\\\\.\\DISPLAY2', 1920, 1920, 1080, [{ name: 'PLACEHOLDER PJ', serial: 0x1111 }]),
    ];
    const displays = [
      shown(10, 'Built in', 0, 1920, 1080, true, 1280),
      shown(30, 'PLACEHOLDER PJ', 3200),
      shown(20, 'PLACEHOLDER PJ', 1280),
    ];
    const tied = tieWindows(outputs, displays);
    expect([...tied].map(([id, o]) => [id, o.gdi])).toEqual([
      [10, '\\\\.\\DISPLAY1'],
      [20, '\\\\.\\DISPLAY2'],
      [30, '\\\\.\\DISPLAY3'],
    ]);
    const reading = windowsReading(outputs, displays);
    expect(reading.ids.get(20)).toBe('edid:4183:1234:n1111');
    expect(reading.ids.get(30)).toBe('edid:4183:1234:n2222');
    expect(reading.mirroredOnto).toEqual([]);
  });

  it('a size that does not tie as many as Electron has is left untied', () => {
    const outputs = [
      output('\\\\.\\DISPLAY1', 0, 1920, 1080, [{ name: 'A', serial: 1 }], true),
      output('\\\\.\\DISPLAY2', 1920, 1280, 720, [{ name: 'B', serial: 0x22 }]),
    ];
    const tied = tieWindows(outputs, [shown(1, 'A', 0, 1920, 1080, true), shown(2, 'B', 1920, 1920, 1080)]);
    expect([...tied.keys()]).toEqual([1]);
  });

  it('an output is never tied to two displays: sizes that could be either are left untied', () => {
    // Two displays Electron sizes a pixel apart (its rounding at a scale), two outputs either could be.
    const outputs = [
      output('\\\\.\\DISPLAY1', 0, 1920, 1080, [{ name: 'A', serial: 1 }], true),
      output('\\\\.\\DISPLAY2', 1920, 1366, 768, [{ name: 'B', serial: 0x22 }]),
      output('\\\\.\\DISPLAY3', 3286, 1366, 768, [{ name: 'C', serial: 0x33 }]),
    ];
    const tied = tieWindows(outputs, [
      shown(1, 'A', 0, 1920, 1080, true),
      shown(2, 'B', 1920, 1366, 768),
      shown(3, 'C', 3286, 1367, 768),
    ]);
    expect([...tied.keys()]).toEqual([1]);
    expect(new Set(tied.values()).size).toBe(tied.size);
  });

  it('Duplicate (one output on two displays) is mirroring: said, and no identity for it', () => {
    const outputs = [
      output(
        '\\\\.\\DISPLAY1',
        0,
        1920,
        1080,
        [
          { name: 'Built in', serial: 0x5, internal: true },
          { name: 'PLACEHOLDER PJ', serial: 0x1111 },
        ],
        true,
      ),
    ];
    const reading = windowsReading(outputs, [shown(1, 'Built in', 0, 1920, 1080, true)]);
    expect(reading.mirroredOnto).toEqual(['PLACEHOLDER PJ']);
    expect(reading.ids.size).toBe(0);
  });

  it('reads only what the script prints; anything else is none', async () => {
    const printed = JSON.stringify({ outputs: [output('\\\\.\\DISPLAY1', 0, 800, 600, [], true)] });
    expect(parseWindowsOutputs(printed)).toHaveLength(1);
    expect(parseWindowsOutputs('')).toBeNull();
    expect(parseWindowsOutputs('{"outputs":[{"gdi":1}]}')).toBeNull();
    expect(await readWindows([], () => Promise.resolve(null))).toBeNull();
    expect(await readWindows([], () => Promise.resolve('Add-Type: not allowed'))).toBeNull();
    const reading = await readWindows([shown(1, 'A', 0, 800, 600, true)], () => Promise.resolve(printed));
    expect(reading).toEqual({ ids: new Map(), mirroredOnto: [] });
  });
});

describe('the identities as Drashti keeps them', () => {
  /** A reader the test answers by hand: each reading waits until it is given. */
  function standIn() {
    const asked: ((r: DisplayReading | null) => void)[] = [];
    let displays = [shown(3, 'PLACEHOLDER PJ', 1440), shown(4, 'PLACEHOLDER PJ', 3360)];
    const ids = new DisplayIds({
      read: () =>
        new Promise((resolve) => {
          asked.push(resolve);
        }),
      displays: () => displays,
    });
    return {
      ids,
      asked,
      setDisplays: (d: TieDisplay[]) => {
        displays = d;
      },
      answer: async (r: DisplayReading | null) => {
        asked.shift()?.(r);
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    };
  }
  const reading = (pairs: [number, string][], mirroredOnto: string[] = []): DisplayReading => ({
    ids: new Map(pairs),
    mirroredOnto,
  });

  it('one reading at a time: a change during one reads once more after it, never more', async () => {
    const s = standIn();
    expect(s.ids.ready()).toBe(false);
    const first = s.ids.refresh();
    const second = s.ids.refresh();
    const third = s.ids.refresh();
    expect(s.asked).toHaveLength(1);
    await s.answer(reading([[3, 'edid:a:1:n1']]));
    await first;
    expect(s.ids.ready()).toBe(true);
    // The two asked meanwhile: one more reading, for both.
    expect(s.asked).toHaveLength(1);
    await s.answer(reading([[3, 'edid:a:1:n1']]));
    await Promise.all([second, third]);
    expect(s.asked).toHaveLength(0);
  });

  it('a display has its identity only while it is as it was read', async () => {
    const s = standIn();
    const done = s.ids.refresh();
    await s.answer(
      reading(
        [
          [3, 'edid:a:1:n1'],
          [4, 'edid:a:1:n2'],
        ],
        ['PLACEHOLDER PJ'],
      ),
    );
    await done;
    expect(s.ids.identityOf(shown(3, 'PLACEHOLDER PJ', 1440))).toBe('edid:a:1:n1');
    expect(s.ids.identityOf(shown(4, 'PLACEHOLDER PJ', 3360))).toBe('edid:a:1:n2');
    // Another display has that id now (another name or size), or one never read: none until it is read.
    expect(s.ids.identityOf(shown(3, 'Other TV', 1440))).toBeNull();
    expect(s.ids.identityOf(shown(3, 'PLACEHOLDER PJ', 1440, 1280, 720))).toBeNull();
    expect(s.ids.identityOf(shown(9, 'PLACEHOLDER PJ', 0))).toBeNull();
    expect(s.ids.mirroredOnto()).toEqual(['PLACEHOLDER PJ']);
  });

  it('two displays read with one identity (units that all give one serial) are given none', async () => {
    const s = standIn();
    const done = s.ids.refresh();
    await s.answer(
      reading([
        [3, 'edid:a:1:n7'],
        [4, 'edid:a:1:n7'],
      ]),
    );
    await done;
    expect(s.ids.identityOf(shown(3, 'PLACEHOLDER PJ', 1440))).toBeNull();
    expect(s.ids.identityOf(shown(4, 'PLACEHOLDER PJ', 3360))).toBeNull();
  });

  it('a reading that fails keeps what was read before', async () => {
    const s = standIn();
    let done = s.ids.refresh();
    await s.answer(reading([[3, 'edid:a:1:n1']]));
    await done;
    done = s.ids.refresh();
    await s.answer(null);
    await done;
    expect(s.ids.identityOf(shown(3, 'PLACEHOLDER PJ', 1440))).toBe('edid:a:1:n1');
  });
});

describe('this computer’s own reader', () => {
  const reader = systemReader();
  // CI's Macs and Windows machines (virtual displays): the real system's answer can be read. Linux has none.
  it.runIf(reader !== null)(
    'answers with a reading of the displays it has',
    async () => {
      const r = await reader?.([]);
      expect(r).not.toBeNull();
      expect(r?.ids).toBeInstanceOf(Map);
      expect(Array.isArray(r?.mirroredOnto)).toBe(true);
    },
    60_000,
  );
  it('Linux has none', () => {
    expect(systemReader('linux')).toBeNull();
  });
});
